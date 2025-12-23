/**
 * Live Arb Markets API
 *
 * GET /api/live-arb/markets
 *
 * Query params:
 *   - platform?: 'kalshi' | 'polymarket' | 'sxbet' - filter by platform
 *   - liveOnly?: 'true' | 'false' - only show live events
 *   - limit?: number - max markets to return (default: 50)
 *
 * Returns watched markets derived from the KV-backed LiveEventsSnapshot.
 *
 * IMPORTANT: This endpoint runs on Vercel serverless and CANNOT use LivePriceCache.
 * LivePriceCache is an in-memory singleton that only exists in the Digital Ocean
 * worker process. Vercel serverless functions are stateless and do not share
 * memory with the DO worker. All data must come from KV storage.
 *
 * Data Flow:
 * - DO Worker: Maintains WebSockets → populates LivePriceCache → writes snapshot to KV
 * - Vercel API: Reads from KV snapshot → returns watched market info
 *
 * The response includes:
 * - Watched markets from active watchers (derived from matched event groups)
 * - Platform connection status and staleness indicators
 * - Price cache stats (from worker heartbeat, not live prices)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getLiveEventsSnapshot,
  getWorkerHeartbeat,
  isHeartbeatFresh,
  LiveEventsSnapshot,
  LiveArbWorkerHeartbeat,
} from '@/lib/kv-storage';
import { MarketPlatform } from '@/types';
import { LiveEventPlatform } from '@/types/live-events';

/**
 * Watched market info derived from KV snapshot.
 * Note: We cannot provide real-time prices since LivePriceCache is not available.
 * Instead, we show which markets are being watched by the DO worker.
 */
interface WatchedMarketInfo {
  id: string;
  platform: MarketPlatform;
  vendorMarketId: string;
  eventKey: string;
  sport: string;
  status: 'PRE' | 'LIVE' | 'ENDED';
  rawTitle: string;
  homeTeam?: string;
  awayTeam?: string;
}

interface PlatformStats {
  platform: MarketPlatform;
  watchedMarkets: number;
  connected: boolean;
  lastMessageAt: string | null;
  /** Age of last message in ms - used for staleness detection */
  lastMessageAgeMs: number | null;
  /** True if platform is stale (no message in >60s while connected) */
  isStale: boolean;
  subscribedMarkets: number;
}

interface LiveMarketsResponse {
  /**
   * Watched markets derived from matched event groups.
   * These are markets the DO worker is actively monitoring for arbitrage.
   */
  watchedMarkets: WatchedMarketInfo[];
  
  /** Total count of watched markets (before limit applied) */
  totalWatchedMarkets: number;
  
  /** Count after filters applied */
  filteredCount: number;
  
  /** Per-platform statistics */
  platformStats: PlatformStats[];
  
  /** Price cache stats from worker heartbeat (not live prices) */
  priceCacheStats: {
    totalEntries: number;
    entriesByPlatform: Record<string, number>;
    totalPriceUpdates: number;
    lastPriceUpdateAt?: string;
  };
  
  /** Worker status */
  workerPresent: boolean;
  workerState: string | null;
  
  /** Snapshot metadata */
  snapshotUpdatedAt: string | null;
  snapshotAgeMs: number | null;
  
  /** Response timestamp */
  timestamp: string;
  
  /** Applied filters */
  filters: {
    platform?: string;
    liveOnly?: boolean;
    limit: number;
  };
  
  /**
   * Explanation for UI when no live prices are available.
   * This helps users understand the architecture limitation.
   */
  notice?: string;
}

/** Map LiveEventPlatform to MarketPlatform */
function toMarketPlatform(platform: LiveEventPlatform): MarketPlatform {
  switch (platform) {
    case 'SXBET': return 'sxbet';
    case 'POLYMARKET': return 'polymarket';
    case 'KALSHI': return 'kalshi';
    default: return 'kalshi';
  }
}

/** Staleness threshold in ms - platform is stale if no message in this time */
const PLATFORM_STALE_THRESHOLD_MS = 60_000;

/**
 * Extract watched markets from the live events snapshot.
 * Returns markets from matched event groups that have active watchers.
 */
function extractWatchedMarkets(
  snapshot: LiveEventsSnapshot | null
): WatchedMarketInfo[] {
  if (!snapshot) return [];
  
  const markets: WatchedMarketInfo[] = [];
  const watchedEventKeys = new Set(
    (snapshot.watchers ?? []).map(w => w.eventKey)
  );
  
  // Get markets from matched groups that have active watchers
  for (const group of snapshot.matchedGroups ?? []) {
    // Only include groups that are being watched
    if (!watchedEventKeys.has(group.eventKey)) continue;
    
    // Extract markets from each platform in the group
    for (const [platformKey, vendorEvents] of Object.entries(group.vendors)) {
      if (!vendorEvents || !Array.isArray(vendorEvents)) continue;
      
      const platform = toMarketPlatform(platformKey as LiveEventPlatform);
      
      for (const ve of vendorEvents) {
        markets.push({
          id: `${platform}:${ve.vendorMarketId}`,
          platform,
          vendorMarketId: ve.vendorMarketId,
          eventKey: group.eventKey,
          sport: group.sport,
          status: group.status,
          rawTitle: ve.rawTitle,
          homeTeam: group.homeTeam,
          awayTeam: group.awayTeam,
        });
      }
    }
  }
  
  return markets;
}

/**
 * Build platform stats from worker heartbeat.
 */
function buildPlatformStats(
  heartbeat: LiveArbWorkerHeartbeat | null,
  watchedMarkets: WatchedMarketInfo[]
): PlatformStats[] {
  const platforms: MarketPlatform[] = ['kalshi', 'polymarket', 'sxbet'];
  const now = Date.now();
  
  // Count watched markets per platform
  const watchedByPlatform: Record<MarketPlatform, number> = {
    kalshi: 0,
    polymarket: 0,
    sxbet: 0,
  };
  for (const m of watchedMarkets) {
    watchedByPlatform[m.platform]++;
  }
  
  return platforms.map(platform => {
    const status = heartbeat?.platforms?.[platform];
    const lastMessageAt = status?.lastMessageAt ?? null;
    const lastMessageAgeMs = lastMessageAt
      ? now - new Date(lastMessageAt).getTime()
      : null;
    
    // Platform is stale if connected but no message in threshold time
    const isStale = status?.connected === true &&
      lastMessageAgeMs !== null &&
      lastMessageAgeMs > PLATFORM_STALE_THRESHOLD_MS;
    
    return {
      platform,
      watchedMarkets: watchedByPlatform[platform],
      connected: status?.connected ?? false,
      lastMessageAt,
      lastMessageAgeMs,
      isStale,
      subscribedMarkets: status?.subscribedMarkets ?? 0,
    };
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LiveMarketsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse query params
    const platformFilter = req.query.platform as MarketPlatform | undefined;
    const liveOnly = req.query.liveOnly === 'true';
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));

    // Fetch KV data in parallel
    const [snapshot, heartbeat] = await Promise.all([
      getLiveEventsSnapshot(),
      getWorkerHeartbeat(),
    ]);
    
    const workerPresent = isHeartbeatFresh(heartbeat, 60_000);
    
    // Calculate snapshot age
    const snapshotAgeMs = snapshot?.updatedAt
      ? Date.now() - new Date(snapshot.updatedAt).getTime()
      : null;
    
    // Extract watched markets from snapshot
    let watchedMarkets = extractWatchedMarkets(snapshot);
    const totalWatchedMarkets = watchedMarkets.length;
    
    // Apply filters
    if (platformFilter) {
      watchedMarkets = watchedMarkets.filter(m => m.platform === platformFilter);
    }
    
    if (liveOnly) {
      watchedMarkets = watchedMarkets.filter(m => m.status === 'LIVE');
    }
    
    const filteredCount = watchedMarkets.length;
    
    // Apply limit
    if (watchedMarkets.length > limit) {
      watchedMarkets = watchedMarkets.slice(0, limit);
    }
    
    // Build platform stats
    const platformStats = buildPlatformStats(heartbeat, watchedMarkets);
    
    // Extract price cache stats from heartbeat
    const priceCacheStats = {
      totalEntries: heartbeat?.priceCacheStats?.totalEntries ?? 0,
      entriesByPlatform: heartbeat?.priceCacheStats?.entriesByPlatform ?? {
        kalshi: 0,
        polymarket: 0,
        sxbet: 0,
      },
      totalPriceUpdates: heartbeat?.priceCacheStats?.totalPriceUpdates ?? 0,
      lastPriceUpdateAt: heartbeat?.priceCacheStats?.lastPriceUpdateAt,
    };
    
    // Build notice explaining the architecture
    let notice: string | undefined;
    if (!workerPresent) {
      notice = 'Worker is not running. Live price data is only available when the Digital Ocean worker is active.';
    } else if (priceCacheStats.totalEntries === 0) {
      notice = 'Live prices are maintained by the Digital Ocean worker and cannot be displayed in this serverless dashboard. The worker is connected and monitoring these markets.';
    }

    const response: LiveMarketsResponse = {
      watchedMarkets,
      totalWatchedMarkets,
      filteredCount,
      platformStats,
      priceCacheStats,
      workerPresent,
      workerState: heartbeat?.state ?? null,
      snapshotUpdatedAt: snapshot?.updatedAt ?? null,
      snapshotAgeMs,
      timestamp: new Date().toISOString(),
      filters: {
        platform: platformFilter,
        liveOnly,
        limit,
      },
      notice,
    };

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('[API] /api/live-arb/markets error:', error);
    return res.status(500).json({ error: error.message });
  }
}
