import type { NextApiRequest, NextApiResponse } from 'next';
import { generateMatchGraphWithGemini } from '@/lib/gemini-match-graph';

interface MatchGraphCronResponse {
  message: string;
  generatedAt?: string;
  clusters?: number;
  edges?: number;
  stats?: {
    llmLatencyMs: number;
    promptCharacters: number;
    inputMarketCounts: Record<string, number>;
    usage?: {
      promptTokens?: number;
      candidatesTokens?: number;
      totalTokens?: number;
    };
  };
  error?: string;
}

export const config = {
  maxDuration: 300,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MatchGraphCronResponse>
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const expectedSecret =
    process.env.MATCH_GRAPH_CRON_SECRET ?? process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.error(
      '[MatchGraph] Missing MATCH_GRAPH_CRON_SECRET/CRON_SECRET environment variable.'
    );
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!isAuthorized(req, expectedSecret)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const { persist = true, maxMarketsPerPlatform } = parseParams(req);

    const result = await generateMatchGraphWithGemini({
      persist,
      maxMarketsPerPlatform,
    });

    if (req.method === 'GET') {
      console.info(
        `[MatchGraph Cron] Completed with ${result.graph.clusters.length} clusters and ${result.graph.edges.length} edges in ${result.llmLatencyMs}ms`
      );
    }

    return res.status(200).json({
      message: persist
        ? 'Match graph generated and persisted'
        : 'Match graph generated (dry run)',
      generatedAt: result.graph.generatedAt,
      clusters: result.graph.clusters.length,
      edges: result.graph.edges.length,
      stats: {
        llmLatencyMs: result.llmLatencyMs,
        promptCharacters: result.promptCharacters,
        inputMarketCounts: result.inputMarketCounts,
        usage: result.usage,
      },
    });
  } catch (error: any) {
    console.error('[MatchGraph] Generation failed:', error);
    return res.status(500).json({
      message: 'Failed to generate match graph',
      error: error?.message ?? 'Unknown error',
    });
  }
}

function isAuthorized(req: NextApiRequest, expected: string): boolean {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return false;
  }
  return token === expected;
}

function extractBearerToken(header?: string): string | null {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (!trimmed) {
    return null;
  }
  const [scheme, ...rest] = trimmed.split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  const token = rest.join(' ').trim();
  return token || null;
}

function parseParams(req: NextApiRequest): {
  persist: boolean;
  maxMarketsPerPlatform?: number;
} {
  const persistParam = Array.isArray(req.query.persist)
    ? req.query.persist[0]
    : (req.query.persist as string | undefined);
  const maxMarketsParam = Array.isArray(req.query.maxMarkets)
    ? req.query.maxMarkets[0]
    : (req.query.maxMarkets as string | undefined);

  const persist =
    typeof persistParam === 'string'
      ? persistParam.toLowerCase() !== 'false'
      : true;

  const maxMarkets = maxMarketsParam ? Number(maxMarketsParam) : undefined;
  return {
    persist,
    maxMarketsPerPlatform:
      typeof maxMarkets === 'number' && Number.isFinite(maxMarkets)
        ? maxMarkets
        : undefined,
  };
}

