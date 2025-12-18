/**
 * Live Arb Status API
 *
 * GET /api/live-arb/status
 *
 * Returns comprehensive status of the live arbitrage system.
 * 
 * IMPORTANT: This serverless endpoint reads ALL status from KV storage,
 * NOT from in-memory state. The worker process writes its state to KV
 * periodically, and this endpoint reads it back.
 * 
 * This design ensures the Vercel serverless function can accurately
 * display worker status even though it cannot access the worker's
 * in-process WebSocket connections or price cache.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { loadLiveArbRuntimeConfig } from '@/lib/live-arb-runtime-config';
import {
  getWorkerHeartbeat,
  LiveArbWorkerHeartbeat,
  WorkerPlatformStatus,
} from '@/lib/kv-storage';
import { LiveArbRuntimeConfig } from '@/types/live-arb';

/**
 * Heartbeat TTL - worker is considered "present" if heartbeat is fresher than this.
 * Set to 60s to allow for network hiccups when worker writes every 10-15s.
 * Can be overridden via WORKER_HEARTBEAT_STALE_MS env var.
 */
const WORKER_HEARTBEAT_TTL_MS = parseInt(
  process.env.WORKER_HEARTBEAT_STALE_MS || '60000',
  10
);

interface LiveArbStatusResponse {
  workerPresent: boolean;
  workerState: LiveArbWorkerHeartbeat['state'] | null;
  workerHeartbeatAt: string | null;
  runtimeConfig: LiveArbRuntimeConfig | null;
  liveArbEnabled: boolean;
  liveArbReady: boolean;
  timestamp: string;
  platforms: {
    sxbet: PlatformStatus;
    polymarket: PlatformStatus;
    kalshi: PlatformStatus;
  };
  liveEvents: {
    enabled: boolean;
    running: boolean;
    uptimeMs: number;
    registry: {
      countByPlatform: Record<string, number>;
      countByStatus: Record<string, number>;
      updatedAt: number;
    };
    stats: {
      totalVendorEvents: number;
      liveEvents: number;
      preEvents: number;
      matchedGroups: number;
      activeWatchers: number;
      arbChecksTotal: number;
      opportunitiesTotal: number;
    };
    watcherStats: {
      totalArbChecks: number;
      totalOpportunities: number;
      avgChecksPerSecond: number;
      avgCheckTimeMs: number;
      maxCheckTimeMs: number;
      totalMarketsWatched: number;
    };
  };
  priceCacheStats: {
    totalEntries: number;
    entriesByPlatform: Record<string, number>;
    totalPriceUpdates: number;
    oldestUpdateMs?: number;
    newestUpdateMs?: number;
  };
  circuitBreaker: {
    isOpen: boolean;
    consecutiveFailures: number;
    openReason?: string;
    openedAt?: string;
  };
  subscriptionStats: {
    lastUpdateAt?: string;
    updateCount: number;
    currentSubscriptions: Record<string, number>;
    blockedOpportunities: number;
    blockedReasons: Record<string, number>;
  };
}

interface PlatformStatus {
  connected: boolean;
  state: string;
  lastMessageAt: string | null;
  subscribedMarkets: number;
  errorMessage?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LiveArbStatusResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Load runtime config from KV
    let runtimeConfig: LiveArbRuntimeConfig | null = null;
    try {
      runtimeConfig = await loadLiveArbRuntimeConfig();
    } catch (configError) {
      console.error('[API] /api/live-arb/status failed to load runtime config:', configError);
    }

    // Load worker heartbeat from KV - this is the SOURCE OF TRUTH for:
    // - Worker presence
    // - Platform connection statuses
    // - Price cache stats
    // - Circuit breaker state
    const heartbeat = await getWorkerHeartbeat();
    const workerPresent = isHeartbeatFresh(heartbeat);

    // Extract platform statuses from KV heartbeat (NOT in-memory)
    const platforms: LiveArbStatusResponse['platforms'] = {
      sxbet: heartbeat?.platforms?.sxbet ?? getDefaultPlatformStatus('sxbet'),
      polymarket: heartbeat?.platforms?.polymarket ?? getDefaultPlatformStatus('polymarket'),
      kalshi: heartbeat?.platforms?.kalshi ?? getDefaultPlatformStatus('kalshi'),
    };

    // Extract price cache stats from KV heartbeat (NOT in-memory)
    const priceCacheStats: LiveArbStatusResponse['priceCacheStats'] = heartbeat?.priceCacheStats ?? {
      totalEntries: 0,
      entriesByPlatform: { kalshi: 0, polymarket: 0, sxbet: 0 },
      totalPriceUpdates: 0,
    };

    // Extract circuit breaker state from KV heartbeat
    const circuitBreaker: LiveArbStatusResponse['circuitBreaker'] = heartbeat?.circuitBreaker ?? {
      isOpen: false,
      consecutiveFailures: 0,
    };

    // Determine if system is ready based on heartbeat data
    const liveArbReady = workerPresent && 
      heartbeat?.state === 'RUNNING' &&
      !circuitBreaker.isOpen &&
      (platforms.sxbet.connected || platforms.polymarket.connected || platforms.kalshi.connected);

    const response: LiveArbStatusResponse = {
      workerPresent,
      workerState: heartbeat?.state ?? null,
      workerHeartbeatAt: heartbeat?.updatedAt ?? null,
      runtimeConfig,
      liveArbEnabled: runtimeConfig?.liveArbEnabled ?? false,
      liveArbReady,
      timestamp: new Date().toISOString(),
      platforms,
      // Live events data - defaults when no heartbeat
      liveEvents: {
        enabled: runtimeConfig?.ruleBasedMatcherEnabled ?? false,
        running: workerPresent && heartbeat?.state === 'RUNNING',
        uptimeMs: 0,
        registry: {
          countByPlatform: {},
          countByStatus: {},
          updatedAt: 0,
        },
        stats: {
          totalVendorEvents: heartbeat?.totalMarkets ?? 0,
          liveEvents: 0,
          preEvents: 0,
          matchedGroups: 0,
          activeWatchers: 0,
          arbChecksTotal: 0,
          opportunitiesTotal: 0,
        },
        watcherStats: {
          totalArbChecks: 0,
          totalOpportunities: 0,
          avgChecksPerSecond: 0,
          avgCheckTimeMs: 0,
          maxCheckTimeMs: 0,
          totalMarketsWatched: 0,
        },
      },
      priceCacheStats,
      circuitBreaker,
      subscriptionStats: {
        updateCount: 0,
        currentSubscriptions: {},
        blockedOpportunities: 0,
        blockedReasons: {},
      },
    };

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('[API] /api/live-arb/status error:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Get default platform status when no heartbeat data exists.
 * Shows appropriate messaging for each platform.
 */
function getDefaultPlatformStatus(platform: 'sxbet' | 'polymarket' | 'kalshi'): PlatformStatus {
  // Check if SX.bet is disabled due to missing env var
  if (platform === 'sxbet' && !process.env.SXBET_WS_URL) {
    return {
      connected: false,
      state: 'disabled',
      lastMessageAt: null,
      subscribedMarkets: 0,
      errorMessage: 'SXBET_WS_URL not configured',
    };
  }

  return {
    connected: false,
    state: 'no_worker',
    lastMessageAt: null,
    subscribedMarkets: 0,
    errorMessage: 'Worker not running or no heartbeat received',
  };
}

/**
 * Check if worker heartbeat is fresh (within TTL).
 * Returns true if worker is considered "present".
 */
function isHeartbeatFresh(heartbeat: LiveArbWorkerHeartbeat | null): boolean {
  if (!heartbeat?.updatedAt) return false;
  const age = Date.now() - new Date(heartbeat.updatedAt).getTime();
  return age <= WORKER_HEARTBEAT_TTL_MS;
}

