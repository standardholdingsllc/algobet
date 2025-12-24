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
 * 
 * DIAGNOSTICS: Add ?debug=1 to get KV diagnostic info (kvHost, kvKeyRead, kvReadResult).
 * This helps debug environment mismatches between DO worker and Vercel.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { loadLiveArbRuntimeConfig } from '@/lib/live-arb-runtime-config';
import {
  getWorkerHeartbeatWithDiagnostics,
  LiveArbWorkerHeartbeat,
  WorkerPlatformStatus,
  WorkerState,
  isHeartbeatFresh,
  KVDiagnostics,
  WORKER_HEARTBEAT_KEY,
} from '@/lib/kv-storage';
import { LiveArbRuntimeConfig } from '@/types/live-arb';
import { LiveEventsDebugCounters } from '@/lib/live-events-debug';

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

/**
 * KV status indicator for the UI.
 * Surfaces the exact reason when data is missing.
 */
export type KVStatus = 
  | 'ok'              // KV read succeeded, data present
  | 'misconfigured'   // Missing KV_REST_API_URL or KV_REST_API_TOKEN
  | 'no_heartbeat'    // KV configured but heartbeat key is missing/null
  | 'parse_error'     // KV returned data but it failed validation
  | 'kv_unreachable'; // KV configured but read failed (network/auth error)

interface LiveArbStatusResponse {
  /** KV status - explicit reason when data is missing */
  kvStatus: KVStatus;
  /** Human-readable explanation for kvStatus */
  kvStatusReason: string;
  
  workerPresent: boolean;
  workerState: WorkerState | null;
  workerHeartbeatAt: string | null;
  workerHeartbeatAgeMs: number | null;
  heartbeatIntervalMs: number | null;
  /** Monotonic tick count - proves heartbeat loop is advancing */
  heartbeatTickCount: number | null;
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
      activeWatchers?: number;
    };
  };
  
  subscriptionStats: {
    lastUpdateAt?: string;
    updateCount: number;
    currentSubscriptions: Record<string, number>;
    blockedOpportunities: number;
    blockedReasons: Record<string, number>;
  };
  liveEventsDebug: LiveEventsDebugCounters;
  
  /** KV diagnostics - only included when ?debug=1 */
  kvDiagnostics?: KVDiagnostics & {
    /** Raw SX.bet status from KV heartbeat (for debugging) */
    rawSxbetFromKv?: WorkerPlatformStatus | null;
    /** Raw heartbeat updatedAt timestamp */
    heartbeatUpdatedAt?: string | null;
  };
}

interface PlatformStatus {
  connected: boolean;
  state: string;
  lastMessageAt: string | null;
  /** Computed at read-time using server's Date.now() - NOT from worker's cached value */
  lastMessageAgeMs: number | null;
  /** Computed at read-time: true if connected but lastMessageAgeMs > STALE_THRESHOLD_MS */
  isStale: boolean;
  subscribedMarkets: number;
  errorMessage?: string;
  disabled?: boolean;
  disabledReason?: string;
}

/** Threshold for marking a connected platform as "stale" (no message in 60s) */
const PLATFORM_STALE_THRESHOLD_MS = 60_000;

// ============================================================================
// Handler
// ============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LiveArbStatusResponse | { error: string }>
) {
  // Disable caching - always return fresh data
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if debug mode is enabled
  const debugMode = req.query.debug === '1' || process.env.DEBUG_STATUS === '1';

  try {
    // Load runtime config from KV
    let runtimeConfig: LiveArbRuntimeConfig | null = null;
    try {
      runtimeConfig = await loadLiveArbRuntimeConfig();
    } catch (configError) {
      console.error('[API] /api/live-arb/status failed to load runtime config:', configError);
    }

    // Load worker heartbeat from KV with diagnostics - this is the SOURCE OF TRUTH
    const { heartbeat, diagnostics } = await getWorkerHeartbeatWithDiagnostics();
    
    // Determine KV status and reason based on diagnostics
    let kvStatus: KVStatus;
    let kvStatusReason: string;
    
    switch (diagnostics.kvReadResult) {
      case 'ok':
        kvStatus = 'ok';
        kvStatusReason = 'Heartbeat read successfully';
        break;
      case 'misconfigured':
        kvStatus = 'misconfigured';
        kvStatusReason = diagnostics.kvError || 'Missing KV_REST_API_URL or KV_REST_API_TOKEN';
        break;
      case 'null':
        kvStatus = 'no_heartbeat';
        kvStatusReason = `Heartbeat key "${WORKER_HEARTBEAT_KEY}" not found in KV - worker may not be running or writing to different KV instance`;
        break;
      case 'parse_error':
        kvStatus = 'parse_error';
        kvStatusReason = diagnostics.kvError || 'Heartbeat data failed validation';
        break;
      case 'error':
        kvStatus = 'kv_unreachable';
        kvStatusReason = diagnostics.kvError || 'Failed to connect to KV';
        break;
      default:
        kvStatus = 'kv_unreachable';
        kvStatusReason = 'Unknown KV error';
    }
    
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

    const defaultDebugCounters: LiveEventsDebugCounters = {
      lastUpdatedAt: '',
      vendorEventsFetched: 0,
      vendorEventsByPlatform: { SXBET: 0, POLYMARKET: 0, KALSHI: 0 },
      vendorEventsFilteredOut: {},
      liveClassifiedCount: 0,
      preClassifiedCount: 0,
      matchCandidatesConsidered: 0,
      matchRejectReasons: {},
      watchersCreated: 0,
      watchersCreatedPre: 0,  // Phase 6
      watchersCreatedLive: 0, // Phase 6
      watchersSkipped: {},
      subscriptionsAttempted: 0,
      subscriptionsAttemptedPre: 0,  // Phase 6
      subscriptionsAttemptedLive: 0, // Phase 6
      subscriptionsFailed: {},
      platformFetch: {
        KALSHI: { attempted: 0, skipped: 0, skipReasons: {} },
        POLYMARKET: { attempted: 0, skipped: 0, skipReasons: {} },
        SXBET: { attempted: 0, skipped: 0, skipReasons: {} },
      },
      kalshi: {
        fetchAttempted: 0,
        fetchFailed: 0,
        rawItemsCount: 0,
        parsedEventsCount: 0,
        filteredOut: {},
        filteredToCloseWindowCount: 0,
        filteredByStatusCount: 0,
        rawStatusHistogram: {},
        dropReasons: {},
        sampleDroppedItems: [],
        queryApplied: undefined,
        sampleRawItems: [],
      },
    };

    const liveEventsStats = heartbeat?.liveEventsStats;
    const liveEventsDebug = heartbeat?.liveEventsDebug ?? defaultDebugCounters;
    const registryStats = liveEventsStats?.registry;
    const watcherStats = liveEventsStats?.watcher;
    const matcherStats = liveEventsStats?.matcher;

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
      // KV status - explicit reason when data is missing
      kvStatus,
      kvStatusReason,
      
      workerPresent,
      workerState: heartbeat?.state ?? null,
      workerHeartbeatAt: heartbeat?.updatedAt ?? null,
      workerHeartbeatAgeMs,
      heartbeatIntervalMs: heartbeat?.heartbeatIntervalMs ?? null,
      heartbeatTickCount: heartbeat?.heartbeatTickCount ?? null,
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
          countByPlatform: registryStats?.byPlatform ?? {},
          countByStatus: registryStats?.byStatus ?? {},
          updatedAt: 0,
        },
        stats: {
          totalVendorEvents: registryStats?.totalEvents ?? heartbeat?.totalMarkets ?? 0,
          liveEvents: registryStats?.byStatus?.LIVE ?? 0,
          preEvents: registryStats?.byStatus?.PRE ?? 0,
          matchedGroups: matcherStats?.totalGroups ?? 0,
          activeWatchers: watcherStats?.activeWatchers ?? 0,
          arbChecksTotal: watcherStats?.totalArbChecks ?? 0,
          opportunitiesTotal: watcherStats?.totalOpportunities ?? 0,
        },
        watcherStats: watcherStats ?? {
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
      liveEventsDebug,
      
      // Include KV diagnostics in debug mode
      ...(debugMode && { 
        kvDiagnostics: {
          ...diagnostics,
          // Include raw SX.bet status from KV for debugging
          rawSxbetFromKv: heartbeat?.platforms?.sxbet ?? null,
          heartbeatUpdatedAt: heartbeat?.updatedAt ?? null,
        }
      }),
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
 * Compute lastMessageAgeMs at read-time using server's Date.now().
 * 
 * IMPORTANT: Do NOT trust the worker's pre-computed lastMessageAgeMs or isStale values.
 * Those are computed at write-time and become stale by the time we read them.
 */
function computeMessageAge(lastMessageAt: string | null): number | null {
  if (!lastMessageAt) return null;
  try {
    return Date.now() - new Date(lastMessageAt).getTime();
  } catch {
    return null;
  }
}

/**
 * Build platform status for API response.
 * 
 * ============================================================================
 * CRITICAL: NEVER gate platform status by Vercel's own env vars!
 * ============================================================================
 * 
 * Vercel serverless does NOT have platform credentials (SXBET_WS_URL, etc).
 * The source of truth for platform status is the KV heartbeat written by the DO worker.
 * 
 * If you're tempted to add a check like `if (!process.env.SXBET_WS_URL)` here, DON'T.
 * The worker decides if a platform is disabled and writes that to KV.
 * 
 * Logic:
 * - If worker has KV status for this platform, use it (including disabled state)
 * - If worker is not present (stale heartbeat), show "no_worker"
 * - If worker is present but no status for this platform, show "initializing"
 * 
 * Staleness (isStale) and lastMessageAgeMs are computed at READ-TIME using the
 * server's Date.now(), not the worker's pre-computed values which become stale.
 */
function buildPlatformStatus(
  kvStatus: WorkerPlatformStatus | undefined,
  platform: 'sxbet' | 'polymarket' | 'kalshi',
  workerPresent: boolean
): PlatformStatus {
  // Compute message age at read-time (not from worker's cached value)
  const lastMessageAgeMs = computeMessageAge(kvStatus?.lastMessageAt ?? null);
  
  // If we have KV status and it shows disabled, use that (worker decided it's disabled)
  if (kvStatus?.disabled) {
    return {
      connected: false,
      state: 'disabled',
      lastMessageAt: kvStatus.lastMessageAt,
      lastMessageAgeMs,
      isStale: false, // Disabled platforms aren't "stale", they're disabled
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
      lastMessageAgeMs: null,
      isStale: false, // No worker = not "stale", just absent
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
      lastMessageAgeMs: null,
      isStale: false,
      subscribedMarkets: 0,
    };
  }

  // Compute isStale at read-time: connected but no message in >60s
  const isStale = kvStatus.connected && 
    lastMessageAgeMs !== null && 
    lastMessageAgeMs > PLATFORM_STALE_THRESHOLD_MS;

  // Worker is present and we have KV status - use it as source of truth
  return {
    connected: kvStatus.connected,
    state: kvStatus.state,
    lastMessageAt: kvStatus.lastMessageAt,
    lastMessageAgeMs,
    isStale,
    subscribedMarkets: kvStatus.subscribedMarkets,
    errorMessage: kvStatus.errorMessage,
  };
}
