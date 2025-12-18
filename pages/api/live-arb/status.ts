/**
 * Live Arb Status API
 *
 * GET /api/live-arb/status
 *
 * Returns comprehensive status of the live arbitrage system.
 * 
 * IMPORTANT: This serverless endpoint reads ALL status from KV storage,
 * NOT from in-memory state. The worker process writes its state to KV
 * via a dedicated heartbeat loop (every 5s), and this endpoint reads it back.
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
  WorkerState,
  isHeartbeatFresh,
} from '@/lib/kv-storage';
import { LiveArbRuntimeConfig } from '@/types/live-arb';

/**
 * Heartbeat TTL - worker is considered "present" if heartbeat is fresher than this.
 * Default 60s allows for temporary KV write failures when heartbeat writes every 5s.
 * Can be overridden via WORKER_HEARTBEAT_STALE_MS env var.
 */
const WORKER_HEARTBEAT_STALE_MS = parseInt(
  process.env.WORKER_HEARTBEAT_STALE_MS || '60000',
  10
);

// ============================================================================
// Response Types
// ============================================================================

interface LiveArbStatusResponse {
  workerPresent: boolean;
  workerState: WorkerState | null;
  workerHeartbeatAt: string | null;
  workerHeartbeatAgeMs: number | null;
  heartbeatIntervalMs: number | null;
  runtimeConfig: LiveArbRuntimeConfig | null;
  liveArbEnabled: boolean;
  liveArbReady: boolean;
  timestamp: string;
  
  // Shutdown metadata (populated during graceful shutdown)
  shutdown: {
    inProgress: boolean;
    reason: string | null;
    startedAt: string | null;
  };
  
  // Refresh cycle metadata (separate from heartbeat timing)
  refresh: {
    inProgress: boolean;
    lastRefreshAt: string | null;
    lastRefreshDurationMs: number | null;
    intervalMs: number | null;
    totalMarkets: number | null;
  };

  platforms: {
    sxbet: PlatformStatus;
    polymarket: PlatformStatus;
    kalshi: PlatformStatus;
  };
  
  priceCacheStats: {
    totalEntries: number;
    entriesByPlatform: Record<string, number>;
    totalPriceUpdates: number;
    oldestUpdateMs?: number;
    newestUpdateMs?: number;
    lastPriceUpdateAt?: string;
  };
  
  circuitBreaker: {
    isOpen: boolean;
    consecutiveFailures: number;
    openReason?: string;
    openedAt?: string;
  };
  
  // Legacy fields for backward compatibility
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
  disabled?: boolean;
  disabledReason?: string;
}

// ============================================================================
// Handler
// ============================================================================

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

    // Load worker heartbeat from KV - this is the SOURCE OF TRUTH
    const heartbeat = await getWorkerHeartbeat();
    const workerPresent = isHeartbeatFresh(heartbeat, WORKER_HEARTBEAT_STALE_MS);
    
    // Calculate heartbeat age for debugging
    const workerHeartbeatAgeMs = heartbeat?.updatedAt 
      ? Date.now() - new Date(heartbeat.updatedAt).getTime()
      : null;

    // Extract platform statuses from KV heartbeat
    // If worker is present, use the KV values
    // If worker is stale, show "no_worker" EXCEPT for disabled platforms
    const platforms: LiveArbStatusResponse['platforms'] = {
      sxbet: buildPlatformStatus(heartbeat?.platforms?.sxbet, 'sxbet', workerPresent),
      polymarket: buildPlatformStatus(heartbeat?.platforms?.polymarket, 'polymarket', workerPresent),
      kalshi: buildPlatformStatus(heartbeat?.platforms?.kalshi, 'kalshi', workerPresent),
    };

    // Extract price cache stats from KV heartbeat
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

    // Check if worker is stopping/starting
    const isShuttingDown = heartbeat?.state === 'STOPPING';
    const isStarting = heartbeat?.state === 'STARTING';

    // Determine if system is ready for trading
    // Not ready during shutdown, startup, or if circuit breaker is open
    const liveArbReady = workerPresent && 
      heartbeat?.state === 'RUNNING' &&
      !isShuttingDown &&
      !isStarting &&
      !circuitBreaker.isOpen &&
      (platforms.sxbet.connected || platforms.polymarket.connected || platforms.kalshi.connected);

    const response: LiveArbStatusResponse = {
      workerPresent,
      workerState: heartbeat?.state ?? null,
      workerHeartbeatAt: heartbeat?.updatedAt ?? null,
      workerHeartbeatAgeMs,
      heartbeatIntervalMs: heartbeat?.heartbeatIntervalMs ?? null,
      runtimeConfig,
      liveArbEnabled: runtimeConfig?.liveArbEnabled ?? false,
      liveArbReady,
      timestamp: new Date().toISOString(),
      
      // Shutdown metadata
      shutdown: {
        inProgress: isShuttingDown,
        reason: heartbeat?.shutdownReason ?? null,
        startedAt: heartbeat?.shutdownStartedAt ?? null,
      },
      
      // Refresh metadata (decoupled from heartbeat)
      refresh: {
        inProgress: heartbeat?.refreshInProgress ?? false,
        lastRefreshAt: heartbeat?.lastRefreshAt ?? null,
        lastRefreshDurationMs: heartbeat?.lastRefreshDurationMs ?? null,
        intervalMs: heartbeat?.refreshIntervalMs ?? null,
        totalMarkets: heartbeat?.totalMarkets ?? null,
      },
      
      platforms,
      priceCacheStats,
      circuitBreaker,
      
      // Legacy liveEvents structure for backward compatibility
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

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build platform status for API response.
 * 
 * Logic:
 * - If platform is disabled (e.g., SXBET_WS_URL missing), show "disabled" regardless of worker state
 * - If worker is present and heartbeat is fresh, use the KV values
 * - If worker is stale/missing, show "no_worker"
 */
function buildPlatformStatus(
  kvStatus: WorkerPlatformStatus | undefined,
  platform: 'sxbet' | 'polymarket' | 'kalshi',
  workerPresent: boolean
): PlatformStatus {
  // Check if platform is disabled at the API level (for when no heartbeat exists)
  if (platform === 'sxbet' && !process.env.SXBET_WS_URL) {
    return {
      connected: false,
      state: 'disabled',
      lastMessageAt: null,
      subscribedMarkets: 0,
      disabled: true,
      disabledReason: 'SXBET_WS_URL not configured',
    };
  }

  // If we have KV status and it shows disabled, always use that
  if (kvStatus?.disabled) {
    return {
      connected: false,
      state: 'disabled',
      lastMessageAt: kvStatus.lastMessageAt,
      subscribedMarkets: 0,
      disabled: true,
      disabledReason: kvStatus.disabledReason || kvStatus.errorMessage,
    };
  }

  // If worker is not present (stale heartbeat), show no_worker
  if (!workerPresent) {
    return {
      connected: false,
      state: 'no_worker',
      lastMessageAt: null,
      subscribedMarkets: 0,
      errorMessage: 'Worker heartbeat stale or missing',
    };
  }

  // Worker is present but no KV status for this platform
  if (!kvStatus) {
    return {
      connected: false,
      state: 'initializing',
      lastMessageAt: null,
      subscribedMarkets: 0,
    };
  }

  // Worker is present and we have KV status - use it
  return {
    connected: kvStatus.connected,
    state: kvStatus.state,
    lastMessageAt: kvStatus.lastMessageAt,
    subscribedMarkets: kvStatus.subscribedMarkets,
    errorMessage: kvStatus.errorMessage,
  };
}
