import { LiveMarketFetcher } from '../lib/live-market-fetcher';
import {
  KVStorage,
  getOrSeedBotConfig,
  updateWorkerHeartbeat,
  LiveArbWorkerHeartbeat,
  WorkerPlatformStatus,
  WorkerPriceCacheStats,
  WorkerState,
} from '../lib/kv-storage';
import { BotConfig, AccountBalance } from '@/types';
import { LiveArbRuntimeConfig, WsClientStatus } from '@/types/live-arb';
import { LiveArbManager } from '../lib/live-arb-manager';
import { loadLiveArbRuntimeConfig } from '../lib/live-arb-runtime-config';
import { buildLiveArbConfig, getLiveArbStatus } from '../lib/live-arb-integration';
import {
  startOrchestrator,
  stopOrchestrator,
  refreshRegistry,
} from '../lib/live-sports-orchestrator';
import { liveArbLog } from '../lib/live-arb-logger';
import { PlatformAdapters, ExecutionOptions } from '../lib/execution-wrapper';
import { KalshiAPI } from '../lib/markets/kalshi';
import { PolymarketAPI } from '../lib/markets/polymarket';
import { SXBetAPI } from '../lib/markets/sxbet';
import { LivePriceCache } from '../lib/live-price-cache';

// ============================================================================
// Configuration
// ============================================================================

const WORKER_TAG = 'LiveArbWorker';

// Environment validation
const SXBET_WS_URL = (process.env.SXBET_WS_URL || '').trim();
const SXBET_WS_DISABLED = !SXBET_WS_URL;

// Refresh interval for market data (can be slow/heavy)
const DEFAULT_REFRESH_INTERVAL_MS = parseInt(
  process.env.LIVE_ARB_WORKER_REFRESH_MS || '15000',
  10
);

// Polling interval when idle (waiting for dashboard to enable)
const IDLE_POLL_INTERVAL_MS = parseInt(
  process.env.LIVE_ARB_IDLE_POLL_MS || '5000',
  10
);

// CRITICAL: Heartbeat interval - MUST fire reliably
const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.WORKER_HEARTBEAT_INTERVAL_MS || '5000',
  10
);

// Grace period for shutdown
const SHUTDOWN_GRACE_MS = parseInt(
  process.env.WORKER_SHUTDOWN_GRACE_MS || '25000',
  10
);

// Delay before final STOPPED write (so STOPPING is observable)
const SHUTDOWN_STOPPING_DELAY_MS = parseInt(
  process.env.WORKER_SHUTDOWN_STOPPING_DELAY_MS || '1500',
  10
);

// Rate limits for logging
const HEARTBEAT_ERROR_LOG_INTERVAL_MS = 30000;
const HEARTBEAT_STATUS_LOG_INTERVAL_MS = 60000;

// Cooperative yielding threshold
const YIELD_EVERY_N_ITEMS = 100;

// ============================================================================
// Cooperative Yielding Helper
// ============================================================================

/**
 * Yields to the event loop using setImmediate.
 * Call this periodically in long loops to prevent event loop starvation.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ============================================================================
// Worker Implementation
// ============================================================================

class LiveArbWorker {
  private marketFetcher = new LiveMarketFetcher();
  private arbActive = false;
  private processRunning = true;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private adapters: PlatformAdapters;
  private cachedBotConfig: BotConfig | null = null;
  private cachedRuntimeConfig: LiveArbRuntimeConfig | null = null;

  // Heartbeat state - with tick counting for diagnostics
  private heartbeatTickCount = 0;
  private lastHeartbeatWriteAt = 0;
  private lastHeartbeatErrorLogAt = 0;
  private lastHeartbeatStatusLogAt = 0;
  private isHeartbeatWriteInFlight = false;

  // Refresh metadata
  private refreshInProgress = false;
  private lastRefreshAt: string | null = null;
  private lastRefreshDurationMs: number | null = null;
  private lastTotalMarkets: number | null = null;

  // Shutdown state
  private isShuttingDown = false;
  private shutdownReason: string | null = null;
  private shutdownStartedAt: string | null = null;

  constructor(private refreshIntervalMs: number) {
    this.adapters = buildPlatformAdapters();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Main entry point - starts the worker process.
   * CRITICAL: Heartbeat loop starts FIRST before any heavy init.
   */
  async start(): Promise<void> {
    const startTime = Date.now();
    
    liveArbLog('info', WORKER_TAG, 'Starting live-arb worker', {
      pid: process.pid,
      nodeEnv: process.env.NODE_ENV || 'unknown',
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      refreshIntervalMs: this.refreshIntervalMs,
      shutdownGraceMs: SHUTDOWN_GRACE_MS,
      sxbetWsDisabled: SXBET_WS_DISABLED,
    });

    // STEP 1: Write STARTING state IMMEDIATELY before any heavy init
    try {
      await this.writeHeartbeatDirect('STARTING');
      liveArbLog('info', WORKER_TAG, 'STARTING heartbeat written to KV');
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Failed to write initial STARTING heartbeat', error as Error);
    }

    // STEP 2: Start heartbeat loop BEFORE heavy init
    this.startHeartbeatLoop();

    // STEP 3: Now do potentially slow init
    try {
      this.cachedBotConfig = await getOrSeedBotConfig();
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Failed to load bot config', error as Error);
      // Continue - heartbeat will still run
    }

    // STEP 4: Start main loop
    this.scheduleMainLoop();

    liveArbLog('info', WORKER_TAG, `Worker startup complete in ${Date.now() - startTime}ms`);
  }

  /**
   * Begin graceful shutdown. Called by signal handlers.
   */
  async beginShutdown(reason: string): Promise<void> {
    if (this.isShuttingDown) {
      liveArbLog('warn', WORKER_TAG, 'Shutdown already in progress, ignoring duplicate signal');
      return;
    }

    this.isShuttingDown = true;
    this.shutdownReason = reason;
    this.shutdownStartedAt = new Date().toISOString();
    this.processRunning = false;

    liveArbLog('info', WORKER_TAG, `Beginning graceful shutdown (reason: ${reason})`);

    // IMMEDIATELY write STOPPING to KV
    try {
      await this.writeHeartbeatDirect('STOPPING');
      liveArbLog('info', WORKER_TAG, 'STOPPING heartbeat written to KV');
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Failed to write STOPPING heartbeat', error as Error);
    }

    // Stop timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Stop arb system (closes WebSockets)
    try {
      await this.stopArb();
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Error stopping arb system', error as Error);
    }

    // Wait a bit so STOPPING state is observable
    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_STOPPING_DELAY_MS));

    // Final STOPPED heartbeat
    try {
      await this.writeHeartbeatDirect('STOPPED');
      liveArbLog('info', WORKER_TAG, 'STOPPED heartbeat written to KV');
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Failed to write STOPPED heartbeat', error as Error);
    }

    liveArbLog('info', WORKER_TAG, 'Graceful shutdown complete');
  }

  // ==========================================================================
  // Heartbeat Loop - MUST BE RELIABLE
  // ==========================================================================

  /**
   * Start the dedicated heartbeat loop.
   * Uses setInterval but the callback is lightweight and yields immediately
   * to an async function to prevent blocking.
   */
  private startHeartbeatLoop(): void {
    liveArbLog('info', WORKER_TAG, `Starting heartbeat loop (interval: ${HEARTBEAT_INTERVAL_MS}ms)`);

    // Use setInterval with unref() so it doesn't keep process alive during shutdown
    this.heartbeatTimer = setInterval(() => {
      // Don't block the interval callback - fire and forget
      this.heartbeatTick().catch((err) => {
        // Error already logged in heartbeatTick
      });
    }, HEARTBEAT_INTERVAL_MS);

    // Allow process to exit even if interval is pending
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Single heartbeat tick. Called by interval.
   * Protected against concurrent writes and errors.
   */
  private async heartbeatTick(): Promise<void> {
    if (this.isShuttingDown) return;

    const tickStart = Date.now();
    this.heartbeatTickCount++;

    // Check for delayed heartbeat (event loop starvation warning)
    if (this.lastHeartbeatWriteAt > 0) {
      const sinceLastWrite = tickStart - this.lastHeartbeatWriteAt;
      const expectedInterval = HEARTBEAT_INTERVAL_MS;
      if (sinceLastWrite > expectedInterval * 3) {
        liveArbLog('warn', WORKER_TAG, `Heartbeat delayed: expected ${expectedInterval}ms, actual ${sinceLastWrite}ms`, {
          tickCount: this.heartbeatTickCount,
          refreshInProgress: this.refreshInProgress,
        });
      }
    }

    // Skip if previous write still in flight (don't queue up)
    if (this.isHeartbeatWriteInFlight) {
      return;
    }

    // Determine state
    const state: WorkerState = this.arbActive ? 'RUNNING' : 'IDLE';

    // Write heartbeat
    await this.writeHeartbeat(state);

    // Periodic status log (every 60s)
    const now = Date.now();
    if (now - this.lastHeartbeatStatusLogAt >= HEARTBEAT_STATUS_LOG_INTERVAL_MS) {
      liveArbLog('info', WORKER_TAG, 'Heartbeat OK', {
        tickCount: this.heartbeatTickCount,
        lastWriteAgoMs: now - this.lastHeartbeatWriteAt,
        intervalMs: HEARTBEAT_INTERVAL_MS,
        state,
        arbActive: this.arbActive,
        refreshInProgress: this.refreshInProgress,
      });
      this.lastHeartbeatStatusLogAt = now;
    }
  }

  /**
   * Write heartbeat to KV with lock and error handling.
   */
  private async writeHeartbeat(state: WorkerState): Promise<void> {
    this.isHeartbeatWriteInFlight = true;

    try {
      const heartbeat = await this.buildHeartbeatPayload(state);
      await updateWorkerHeartbeat(heartbeat);
      this.lastHeartbeatWriteAt = Date.now();
    } catch (error) {
      // Rate-limit error logs
      const now = Date.now();
      if (now - this.lastHeartbeatErrorLogAt > HEARTBEAT_ERROR_LOG_INTERVAL_MS) {
        liveArbLog('error', WORKER_TAG, 'Failed to write heartbeat to KV', error as Error);
        this.lastHeartbeatErrorLogAt = now;
      }
    } finally {
      // ALWAYS release lock
      this.isHeartbeatWriteInFlight = false;
    }
  }

  /**
   * Direct heartbeat write for lifecycle transitions (STARTING/STOPPING/STOPPED).
   * Bypasses the lock and always writes.
   */
  private async writeHeartbeatDirect(state: WorkerState): Promise<void> {
    const heartbeat = await this.buildHeartbeatPayload(state);
    await updateWorkerHeartbeat(heartbeat);
    this.lastHeartbeatWriteAt = Date.now();
  }

  /**
   * Build heartbeat payload. Uses cooperative yielding for large data.
   */
  private async buildHeartbeatPayload(state: WorkerState): Promise<LiveArbWorkerHeartbeat> {
    // Collect platform statuses (fast - in memory)
    const wsStatuses = LiveArbManager.getWsStatuses();
    const platforms = {
      sxbet: this.formatPlatformStatusForKV(wsStatuses.sxbet, 'sxbet'),
      polymarket: this.formatPlatformStatusForKV(wsStatuses.polymarket, 'polymarket'),
      kalshi: this.formatPlatformStatusForKV(wsStatuses.kalshi, 'kalshi'),
    };

    // Collect price cache stats with yielding
    const priceCacheStats = await this.collectPriceCacheStatsAsync();

    // Get circuit breaker (fast - in memory)
    const status = getLiveArbStatus();
    const circuitBreaker = {
      isOpen: status.safetyStatus.circuitBreakerOpen,
      consecutiveFailures: status.safetyStatus.circuitBreakerState.consecutiveFailures,
      openReason: status.safetyStatus.circuitBreakerState.openReason,
      openedAt: status.safetyStatus.circuitBreakerState.openedAt,
    };

    return {
      updatedAt: new Date().toISOString(),
      state,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      heartbeatTickCount: this.heartbeatTickCount,

      // Shutdown metadata
      shutdownReason: this.shutdownReason ?? undefined,
      shutdownStartedAt: this.shutdownStartedAt ?? undefined,

      // Runtime config
      liveArbEnabled: this.cachedRuntimeConfig?.liveArbEnabled,
      ruleBasedMatcherEnabled: this.cachedRuntimeConfig?.ruleBasedMatcherEnabled,
      liveEventsOnly: this.cachedRuntimeConfig?.liveEventsOnly,
      sportsOnly: this.cachedRuntimeConfig?.sportsOnly,

      // Refresh metadata
      refreshIntervalMs: this.refreshIntervalMs,
      refreshInProgress: this.refreshInProgress,
      lastRefreshAt: this.lastRefreshAt ?? undefined,
      lastRefreshDurationMs: this.lastRefreshDurationMs ?? undefined,
      totalMarkets: this.lastTotalMarkets ?? undefined,

      platforms,
      priceCacheStats,
      circuitBreaker,
    };
  }

  /**
   * Collect price cache stats with cooperative yielding.
   */
  private async collectPriceCacheStatsAsync(): Promise<WorkerPriceCacheStats> {
    const cacheStats = LivePriceCache.getStats();
    const pricesByPlatform = LivePriceCache.getPriceCountByPlatform();
    const allPrices = LivePriceCache.getAllPrices();

    let oldestUpdateMs: number | undefined;
    let newestUpdateMs: number | undefined;
    let lastPriceUpdateAt: string | undefined;

    // Process prices with yielding to prevent event loop starvation
    for (let i = 0; i < allPrices.length; i++) {
      const price = allPrices[i];
      const ageMs = price.ageMs ?? 0;
      
      if (oldestUpdateMs === undefined || ageMs > oldestUpdateMs) {
        oldestUpdateMs = ageMs;
      }
      if (newestUpdateMs === undefined || ageMs < newestUpdateMs) {
        newestUpdateMs = ageMs;
        lastPriceUpdateAt = price.lastUpdatedAt;
      }

      // Yield every N items
      if (i > 0 && i % YIELD_EVERY_N_ITEMS === 0) {
        await yieldToEventLoop();
      }
    }

    return {
      totalEntries: cacheStats.priceCacheSize,
      entriesByPlatform: pricesByPlatform,
      totalPriceUpdates: cacheStats.totalPriceUpdates,
      oldestUpdateMs,
      newestUpdateMs,
      lastPriceUpdateAt,
    };
  }

  // ==========================================================================
  // Main Loop
  // ==========================================================================

  private async startArb(runtimeConfig: LiveArbRuntimeConfig): Promise<void> {
    if (this.arbActive || this.isShuttingDown) return;

    try {
      const botConfig = this.cachedBotConfig!;
      const liveArbConfig = buildLiveArbConfig(botConfig, runtimeConfig);

      await LiveArbManager.initialize(liveArbConfig);

      const executionOptions = await this.buildExecutionOptions(botConfig);
      await startOrchestrator(this.adapters, executionOptions);

      this.logExecutionMode(botConfig);
      this.arbActive = true;
      this.cachedRuntimeConfig = runtimeConfig;

      liveArbLog('info', WORKER_TAG, 'Arbitrage system started');

      await this.refreshMarkets(botConfig, runtimeConfig);
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Failed to start arbitrage system', error as Error);
      throw error;
    }
  }

  private async stopArb(): Promise<void> {
    if (!this.arbActive) return;

    liveArbLog('info', WORKER_TAG, 'Stopping arbitrage system...');
    this.arbActive = false;

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    try {
      await stopOrchestrator();
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Error stopping orchestrator', error as Error);
    }

    try {
      await LiveArbManager.shutdown();
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Error shutting down LiveArbManager', error as Error);
    }

    liveArbLog('info', WORKER_TAG, 'Arbitrage system stopped');
  }

  private scheduleMainLoop(): void {
    const loop = async () => {
      if (!this.processRunning || this.isShuttingDown) return;

      try {
        const runtimeConfig = await loadLiveArbRuntimeConfig();
        this.cachedRuntimeConfig = runtimeConfig;
        const shouldBeActive = runtimeConfig.liveArbEnabled;

        if (shouldBeActive && !this.arbActive) {
          liveArbLog('info', WORKER_TAG, 'liveArbEnabled toggled to true – starting arbitrage system');
          await this.startArb(runtimeConfig);
        } else if (!shouldBeActive && this.arbActive) {
          liveArbLog('info', WORKER_TAG, 'liveArbEnabled toggled to false – stopping arbitrage system');
          await this.stopArb();
        } else if (this.arbActive) {
          await this.refreshMarkets(this.cachedBotConfig!, runtimeConfig);
        }
      } catch (error) {
        liveArbLog('error', WORKER_TAG, 'Error in main loop', error as Error);
      }

      if (!this.isShuttingDown) {
        const interval = this.arbActive ? this.refreshIntervalMs : IDLE_POLL_INTERVAL_MS;
        this.refreshTimer = setTimeout(loop, interval);
      }
    };

    loop();
  }

  private async refreshMarkets(
    botConfig: BotConfig,
    runtimeConfig: LiveArbRuntimeConfig
  ): Promise<void> {
    if (this.isShuttingDown) return;

    const startTime = Date.now();
    this.refreshInProgress = true;

    try {
      const filters = this.marketFetcher.buildFiltersFromConfig(botConfig, runtimeConfig);
      const results = await this.marketFetcher.fetchAllPlatforms(filters);
      
      // Collect markets with yielding
      const markets: any[] = [];
      for (const [platform, result] of Object.entries(results)) {
        for (let i = 0; i < result.markets.length; i++) {
          markets.push(result.markets[i]);
          // Yield periodically during large merges
          if (markets.length % YIELD_EVERY_N_ITEMS === 0) {
            await yieldToEventLoop();
          }
        }
      }

      await refreshRegistry(markets);

      this.lastRefreshAt = new Date().toISOString();
      this.lastRefreshDurationMs = Date.now() - startTime;
      this.lastTotalMarkets = markets.length;

      liveArbLog('debug', WORKER_TAG, 'Registry refresh complete', {
        totalMarkets: markets.length,
        durationMs: this.lastRefreshDurationMs,
      });

      if (markets.length === 0) {
        liveArbLog('warn', WORKER_TAG, 'Registry refresh returned 0 markets');
      }
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Registry refresh failed', error as Error);
    } finally {
      this.refreshInProgress = false;
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private formatPlatformStatusForKV(
    status: WsClientStatus | null,
    platform: 'sxbet' | 'polymarket' | 'kalshi'
  ): WorkerPlatformStatus {
    if (platform === 'sxbet' && SXBET_WS_DISABLED) {
      return {
        connected: false,
        state: 'disabled',
        lastMessageAt: null,
        subscribedMarkets: 0,
        disabled: true,
        disabledReason: 'SXBET_WS_URL environment variable not configured',
      };
    }

    if (!status) {
      return {
        connected: false,
        state: this.arbActive ? 'connecting' : 'idle',
        lastMessageAt: null,
        subscribedMarkets: 0,
      };
    }

    return {
      connected: status.state === 'connected',
      state: status.state,
      lastMessageAt: status.lastMessageAt || null,
      subscribedMarkets: status.subscribedMarkets || 0,
      errorMessage: status.errorMessage,
    };
  }

  private async buildExecutionOptions(
    botConfig: BotConfig
  ): Promise<Partial<ExecutionOptions>> {
    const balances = await KVStorage.getBalances();
    const balanceMap = balanceArrayToMap(balances);

    return {
      kalshiBalance: balanceMap.kalshi,
      polymarketBalance: balanceMap.polymarket,
      sxbetBalance: balanceMap.sxbet,
      maxBetPercentage: botConfig.maxBetPercentage,
      minProfitMargin: botConfig.minProfitMargin,
      maxDaysToExpiry: botConfig.maxDaysToExpiry,
    };
  }

  private logExecutionMode(botConfig: BotConfig): void {
    liveArbLog('info', WORKER_TAG, 'Execution mode summary', {
      executionMode: botConfig.liveExecutionMode || 'DRY_FIRE',
      minProfitBps: process.env.LIVE_ARB_MIN_PROFIT_BPS || '50',
      maxPriceAgeMs: process.env.LIVE_ARB_MAX_PRICE_AGE_MS || '2000',
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

function balanceArrayToMap(
  balances: AccountBalance[]
): Record<'kalshi' | 'polymarket' | 'sxbet', number> {
  const map = { kalshi: 0, polymarket: 0, sxbet: 0 };
  for (const balance of balances) {
    map[balance.platform] = balance.availableCash ?? balance.balance ?? map[balance.platform];
  }
  return map;
}

function buildPlatformAdapters(): PlatformAdapters {
  const kalshiApi = new KalshiAPI();
  const polymarketApi = new PolymarketAPI();
  const sxBetApi = new SXBetAPI();

  return {
    kalshi: {
      placeBet: (marketId, ticker, side, price, quantity) =>
        kalshiApi.placeBet(ticker, side, price, quantity),
      cancelOrder: async (orderId: string) => {
        if (!orderId) return;
        await kalshiApi.cancelOrder(orderId);
      },
    },
    polymarket: {
      placeBet: (marketId, ticker, side, price, quantity) =>
        polymarketApi.placeBet(marketId, side, price, quantity),
      cancelOrder: async () => {},
    },
    sxbet: {
      placeBet: (marketId, ticker, side, price, quantity) =>
        sxBetApi.placeBet(marketId, side, price, quantity),
      cancelOrder: async () => {},
    },
  };
}

// ============================================================================
// Entry Point & Signal Handlers
// ============================================================================

const worker = new LiveArbWorker(DEFAULT_REFRESH_INTERVAL_MS);

async function gracefulExit(reason: string, exitCode: number): Promise<never> {
  const timeout = setTimeout(() => {
    liveArbLog('error', WORKER_TAG, `Shutdown timeout (${SHUTDOWN_GRACE_MS}ms) exceeded, forcing exit`);
    process.exit(exitCode);
  }, SHUTDOWN_GRACE_MS);

  try {
    await worker.beginShutdown(reason);
  } catch (error) {
    liveArbLog('error', WORKER_TAG, 'Error during shutdown', error as Error);
  } finally {
    clearTimeout(timeout);
  }

  process.exit(exitCode);
}

// Start worker
worker.start().catch((error) => {
  liveArbLog('error', WORKER_TAG, 'Worker failed to start', error as Error);
  process.exit(1);
});

// Signal handlers
process.on('SIGTERM', () => {
  liveArbLog('info', WORKER_TAG, 'Received SIGTERM');
  gracefulExit('SIGTERM', 0);
});

process.on('SIGINT', () => {
  liveArbLog('info', WORKER_TAG, 'Received SIGINT');
  gracefulExit('SIGINT', 0);
});

process.on('uncaughtException', (error) => {
  liveArbLog('error', WORKER_TAG, 'Uncaught exception', error);
  gracefulExit('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  liveArbLog('error', WORKER_TAG, 'Unhandled rejection', reason as Error);
  gracefulExit('unhandledRejection', 1);
});
