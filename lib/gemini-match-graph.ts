import { randomUUID } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  EventCluster,
  LlmReadyMarket,
  MatchEdge,
  MatchEdgeType,
  MatchGraph,
  MarketKey,
  MarketPlatform,
} from '@/types';
import { toLlmReadySnapshot } from './llm-snapshots';
import { loadMarketSnapshot } from './market-snapshots';
import { SNAPSHOT_PLATFORMS } from './snapshot-platforms';
import { saveMatchGraph } from './match-graph-store';
import { MATCH_GRAPH_VERSION } from './constants';

type LlmPayload = Record<
  MarketPlatform,
  Array<Pick<LlmReadyMarket, 'title' | 'expiry' | 'type'> & { key: MarketKey }>
>;

interface GeminiMatchGraphResponse {
  clusters?: Array<{
    id?: string;
    label?: string;
    markets?: MarketKey[];
  }>;
  edges?: Array<{
    id?: string;
    type?: MatchEdgeType;
    markets?: MarketKey[];
    confidence?: number;
    annotation?: string;
  }>;
  notes?: string[];
}

export interface MatchGraphGenerationOptions {
  persist?: boolean;
  maxMarketsPerPlatform?: number;
  temperature?: number;
}

export interface MatchGraphGenerationResult {
  graph: MatchGraph;
  rawResponse: string;
  promptCharacters: number;
  llmLatencyMs: number;
  inputMarketCounts: Record<MarketPlatform, number>;
  usage?: {
    promptTokens?: number;
    candidatesTokens?: number;
    totalTokens?: number;
  };
}

export async function generateMatchGraphWithGemini(
  options: MatchGraphGenerationOptions = {}
): Promise<MatchGraphGenerationResult> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GOOGLE_GEMINI_API_KEY is not configured. Set it in your environment to enable the match graph worker.'
    );
  }

  const llmPayload = await buildLlmPayload(options.maxMarketsPerPlatform);
  const prompt = buildPrompt(llmPayload);
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction:
      'I am looking to find identical events being offerend on 2 or more of the three platforms (Kalshi, Polymarket, and Sxbet)\n\nHere are all the markets offered for the next several days on these platforms. Some of the events will go by similar but not perfectly matching names, but they are the same event. Find only the same underlying events available on 2 or more of the platforms and group their entries together. Output strict JSON only.',
  });

  const start = Date.now();
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.1,
      topK: 50,
      maxOutputTokens: 6000,
      responseMimeType: 'application/json',
    },
  });
  const latency = Date.now() - start;

  const responseText = result.response?.text();
  if (!responseText) {
    throw new Error('Gemini returned an empty response.');
  }

  let parsed: GeminiMatchGraphResponse;
  try {
    parsed = JSON.parse(responseText) as GeminiMatchGraphResponse;
  } catch (error: any) {
    throw new Error(
      `Gemini response was not valid JSON: ${error?.message || error}\nResponse:\n${responseText}`
    );
  }

  const graph = normalizeMatchGraph(parsed, llmPayload);

  if (options.persist !== false) {
    await saveMatchGraph(graph);
  }

  return {
    graph,
    rawResponse: responseText,
    promptCharacters: prompt.length,
    llmLatencyMs: latency,
    inputMarketCounts: Object.fromEntries(
      SNAPSHOT_PLATFORMS.map((platform) => [platform, llmPayload[platform]?.length ?? 0])
    ) as Record<MarketPlatform, number>,
    usage: result.response?.usageMetadata
      ? {
          promptTokens: result.response.usageMetadata.promptTokenCount,
          candidatesTokens: result.response.usageMetadata.candidatesTokenCount,
          totalTokens: result.response.usageMetadata.totalTokenCount,
        }
      : undefined,
  };
}

async function buildLlmPayload(
  maxMarketsPerPlatform?: number
): Promise<LlmPayload> {
  const entries = await Promise.all(
    SNAPSHOT_PLATFORMS.map(async (platform) => {
      const snapshot = await loadMarketSnapshot(platform);
      if (!snapshot) {
        throw new Error(`Missing snapshot for ${platform}; run snapshot-worker first.`);
      }

      const llmSnapshot = toLlmReadySnapshot(snapshot);
      const limit =
        typeof maxMarketsPerPlatform === 'number' && maxMarketsPerPlatform > 0
          ? maxMarketsPerPlatform
          : llmSnapshot.markets.length;

      const markets = llmSnapshot.markets.slice(0, limit).map((market) => ({
        key: `${platform}:${market.id}` as MarketKey,
        title: market.title,
        expiry: market.expiry,
        type: market.type,
      }));

      return [platform, markets] as const;
    })
  );

  return Object.fromEntries(entries) as LlmPayload;
}

function buildPrompt(payload: LlmPayload): string {
  const summary = SNAPSHOT_PLATFORMS.map((platform) => {
    const count = payload[platform]?.length ?? 0;
    return `- ${platform}: ${count} markets`;
  }).join('\n');

  const schema = `
Return JSON exactly in this shape:
{
  "clusters": [
    {
      "label": "optional human-readable description",
      "markets": ["kalshi:KXTRUMP2024", "polymarket:0xabc", "..."]
    }
  ],
  "edges": [
    {
      "type": "same_outcome | opposite_outcome | same_event | subset",
      "markets": ["kalshi:KXTRUMP2024", "polymarket:0xabc"],
      "confidence": 0.0-1.0,
      "annotation": "why these match (optional)"
    }
  ],
  "notes": ["optional short QA notes"]
}
`;

  return [
    'You will receive JSON arrays of markets from Kalshi, Polymarket, and SX.bet.',
    'Each entry has a `key` ("platform:id"), `title`, `type`, and `expiry`.',
    'Goal: group markets that describe the same underlying real-world event, and classify their relationships.',
    'Rules:',
    '- Only create clusters containing at least two different platforms.',
    '- Emit edges for every high-confidence relationship you find.',
    '- Interpret `same_event` as markets referring to the same question but possibly different outcomes.',
    '- Interpret `same_outcome` when both resolve the same way; `opposite_outcome` for complements; `subset` when one market is a stricter condition.',
    '- Confidence must be between 0.0 and 1.0.',
    '- Stick to the response schema verbatim.',
    '',
    'Platform counts:',
    summary,
    '',
    '---BEGIN MARKET DATA---',
    JSON.stringify(payload),
    '---END MARKET DATA---',
    '',
    schema,
  ].join('\n');
}

function normalizeMatchGraph(
  response: GeminiMatchGraphResponse,
  payload: LlmPayload
): MatchGraph {
  const clusters: EventCluster[] = (response.clusters ?? [])
    .map((cluster, index) => ({
      id: cluster.id || `cluster-${index + 1}-${randomUUID()}`,
      label: cluster.label,
      markets: normalizeMarketKeys(cluster.markets),
    }))
    .map((cluster) => ({
      ...cluster,
      markets: dedupeMarketKeys(cluster.markets),
    }))
    .filter((cluster) => cluster.markets.length >= 2);

  const edges: MatchEdge[] = (response.edges ?? [])
    .map((edge, index) => ({
      id: edge.id || `edge-${index + 1}-${randomUUID()}`,
      type: normalizeEdgeType(edge.type),
      markets: dedupeMarketKeys(normalizeMarketKeys(edge.markets)),
      confidence: sanitizeConfidence(edge.confidence),
      annotation: edge.annotation,
    }))
    .filter((edge) => edge.markets.length >= 2);

  const graph: MatchGraph = {
    version: MATCH_GRAPH_VERSION,
    generatedAt: new Date().toISOString(),
    clusters,
    edges,
    metadata: {
      model: 'gemini-2.0-flash',
      requestMarkets: Object.fromEntries(
        SNAPSHOT_PLATFORMS.map((platform) => [platform, payload[platform]?.length ?? 0])
      ) as Record<MarketPlatform, number>,
      notes: response.notes,
    },
  };

  return graph;
}

function normalizeMarketKeys(values?: MarketKey[]): MarketKey[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => normalizeMarketKey(value))
    .filter((value): value is MarketKey => Boolean(value));
}

function normalizeMarketKey(value: unknown): MarketKey | null {
  if (typeof value !== 'string') {
    return null;
  }
  const [platformPart, ...idParts] = value.split(':');
  const id = idParts.join(':').trim();
  if (!platformPart || !id) {
    return null;
  }
  const platform = SNAPSHOT_PLATFORMS.find(
    (candidate) => candidate === platformPart.toLowerCase()
  );
  if (!platform) {
    return null;
  }
  return `${platform}:${id}` as MarketKey;
}

function dedupeMarketKeys(keys: MarketKey[]): MarketKey[] {
  return Array.from(new Set(keys));
}

function normalizeEdgeType(type?: MatchEdgeType): MatchEdgeType {
  if (!type) {
    return 'same_event';
  }
  const allowed: MatchEdgeType[] = [
    'same_event',
    'same_outcome',
    'opposite_outcome',
    'subset',
  ];
  return allowed.includes(type) ? type : 'same_event';
}

function sanitizeConfidence(value?: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

