import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'crypto';
import { saveMatchGraph } from '@/lib/match-graph-store';
import { MATCH_GRAPH_VERSION } from '@/lib/constants';
import type {
  EventCluster,
  MatchEdge,
  MatchGraph,
  MarketKey,
  MarketPlatform,
} from '@/types';

type PastedMarket = {
  platform: MarketPlatform;
  id: string;
  title?: string;
};

type PastedEvent = {
  event_name: string;
  markets: PastedMarket[];
};

type ImportResponse = {
  message: string;
  clusters?: number;
  edges?: number;
  generatedAt?: string;
  error?: string;
};

type ImportRequestBody = {
  events?: unknown;
};

const SUPPORTED_PLATFORMS: readonly MarketPlatform[] = ['kalshi', 'polymarket', 'sxbet'];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ImportResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const body = parseRequestBody(req.body);
    const eventsPayload = (body as ImportRequestBody)?.events;

    if (!Array.isArray(eventsPayload)) {
      return res.status(400).json({ message: '`events` must be an array' });
    }

    const { clusters, edges, platformCounts } = buildGraphComponents(eventsPayload);

    if (!clusters.length || !edges.length) {
      return res.status(400).json({
        message: 'No valid events with at least two markets were provided',
      });
    }

    const graph: MatchGraph = {
      version: MATCH_GRAPH_VERSION,
      generatedAt: new Date().toISOString(),
      clusters,
      edges,
      metadata: {
        model: 'manual-import',
        requestMarkets: removeZeroCounts(platformCounts),
        notes: ['Imported from pasted Gemini JSON'],
      },
    };

    const savedGraph = await saveMatchGraph(graph);

    return res.status(200).json({
      message: 'Manual match graph imported',
      clusters: savedGraph.clusters.length,
      edges: savedGraph.edges.length,
      generatedAt: savedGraph.generatedAt,
    });
  } catch (error: any) {
    console.error('[MatchGraph Import] Failed to persist manual graph:', error);
    return res.status(500).json({
      message: 'Failed to import manual match graph',
      error: error?.message || 'Unknown error',
    });
  }
}

function parseRequestBody(rawBody: any): ImportRequestBody {
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody);
    } catch {
      throw new Error('Request body is not valid JSON');
    }
  }

  if (rawBody && typeof rawBody === 'object') {
    return rawBody;
  }

  return {};
}

function buildGraphComponents(events: unknown[]): {
  clusters: EventCluster[];
  edges: MatchEdge[];
  platformCounts: Record<MarketPlatform, number>;
} {
  const clusters: EventCluster[] = [];
  const edges: MatchEdge[] = [];
  const platformCounts: Record<MarketPlatform, number> = {
    kalshi: 0,
    polymarket: 0,
    sxbet: 0,
  };
  const globalSeen = new Set<MarketKey>();

  events.forEach((rawEvent, index) => {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return;
    }

    const event = rawEvent as Partial<PastedEvent>;
    const eventName =
      typeof event.event_name === 'string' ? event.event_name.trim() : '';
    const marketsArray = Array.isArray(event.markets) ? event.markets : [];

    const uniqueKeys: MarketKey[] = [];
    const seenInEvent = new Set<string>();

    marketsArray.forEach((rawMarket) => {
      if (!rawMarket || typeof rawMarket !== 'object') {
        return;
      }
      const market = rawMarket as Partial<PastedMarket>;
      const platform = market.platform;
      const id = typeof market.id === 'string' ? market.id.trim() : '';

      if (!isSupportedPlatform(platform) || !id) {
        return;
      }

      const key = createMarketKey(platform, id);
      if (seenInEvent.has(key)) {
        return;
      }
      seenInEvent.add(key);
      uniqueKeys.push(key);

      if (!globalSeen.has(key)) {
        globalSeen.add(key);
        platformCounts[platform] += 1;
      }
    });

    if (uniqueKeys.length < 2) {
      return;
    }

    clusters.push({
      id: `manual-cluster-${index + 1}-${randomUUID()}`,
      label: eventName || undefined,
      markets: uniqueKeys,
    });

    edges.push({
      id: `manual-edge-${index + 1}-${randomUUID()}`,
      type: 'same_event',
      markets: uniqueKeys,
      confidence: 0.95,
      annotation: 'Manual import from Gemini UI',
    });
  });

  return { clusters, edges, platformCounts };
}

function createMarketKey(platform: MarketPlatform, id: string): MarketKey {
  return `${platform}:${id}` as MarketKey;
}

function isSupportedPlatform(platform: any): platform is MarketPlatform {
  return SUPPORTED_PLATFORMS.includes(platform);
}

function removeZeroCounts(
  counts: Record<MarketPlatform, number>
): Record<MarketPlatform, number> {
  const entries = Object.entries(counts).filter(([, value]) => value > 0);
  return Object.fromEntries(entries) as Record<MarketPlatform, number>;
}


