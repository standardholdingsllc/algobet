import { LiveMarketFetcher } from '../lib/live-market-fetcher';
import {
  KVStorage,
  getOrSeedBotConfig,
  updateWorkerHeartbeat,
  LiveArbWorkerHeartbeat,
  WorkerPlatformStatus,
  WorkerPriceCacheStats,
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

// Environment validation for clear error messaging
const SXBET_WS_URL = (process.env.SXBET_WS_URL || '').trim();
const SXBET_WS_DISABLED = !SXBET_WS_URL;

const WORKER_TAG = 'LiveArbWorker';
const DEFAULT_REFRESH_INTERVAL_MS = parseInt(
  process.env.LIVE_ARB_WORKER_REFRESH_MS || '15000',
  10
);
// Polling interval when idle (waiting for dashboard to enable)
const IDLE_POLL_INTERVAL_MS = parseInt(
  process.env.LIVE_ARB_IDLE_POLL_MS || '5000',
  10
);

class LiveArbWorker {
  private marketFetcher = new LiveMarketFetcher();
  private arbActive = false; // Whether WS clients and orchestrator are running
  private processRunning = true; // Whether the worker process should keep polling
  private refreshTimer: NodeJS.Timeout | null = null;
  private adapters: PlatformAdapters;
  private cachedBotConfig: BotConfig | null = null;

  constructor(private refreshIntervalMs: number) {
    this.adapters = buildPlatformAdapters();
  }

  /**
   * Main entry point - starts the worker process and begins polling for config changes.
   * The worker stays alive and responds to liveArbEnabled toggle from the dashboard.
   */
  async start(): Promise<void> {
    liveArbLog('info', WORKER_TAG, 'Starting live-arb worker (script-managed)', {
      pid: process.pid,
      nodeEnv: process.env.NODE_ENV || 'unknown',
    });

    // Cache bot config once at startup
    this.cachedBotConfig = await getOrSeedBotConfig();

    // Start the main loop that checks config and manages arb state
    this.scheduleMainLoop();
  }

  /**
   * Gracefully shutdown the entire worker process
   */
  async shutdown(): Promise<void> {
    this.processRunning = false;
    await this.stopArb();
    liveArbLog('info', WORKER_TAG, 'Worker process shutdown complete');
  }

  /**
   * Start the arbitrage system (WS clients, orchestrator, market refresh)
   */
  private async startArb(runtimeConfig: LiveArbRuntimeConfig): Promise<void> {
    if (this.arbActive) return;

    try {
      const botConfig = this.cachedBotConfig!;
      const liveArbConfig = buildLiveArbConfig(botConfig, runtimeConfig);

      await LiveArbManager.initialize(liveArbConfig);

      const executionOptions = await this.buildExecutionOptions(botConfig);
      await startOrchestrator(this.adapters, executionOptions);

      this.logExecutionMode(botConfig);
      this.arbActive = true;

      liveArbLog('info', WORKER_TAG, 'Arbitrage system started');
      await this.recordHeartbeat('RUNNING', runtimeConfig);

      // Do initial market refresh
      await this.refreshMarkets(botConfig, runtimeConfig);
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Failed to start arbitrage system', error as Error);
      await this.recordHeartbeat('STOPPED');
      throw error;
    }
  }

  /**
   * Stop the arbitrage system (WS clients, orchestrator)
   */
  private async stopArb(): Promise<void> {
    if (!this.arbActive) return;

    this.arbActive = false;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    await stopOrchestrator();
    await LiveArbManager.shutdown();
    await this.recordHeartbeat('STOPPED');
    liveArbLog('info', WORKER_TAG, 'Arbitrage system stopped');
  }

  /**
   * Main loop that polls config and manages arb state based on liveArbEnabled flag.
   * This keeps the worker process alive and responsive to dashboard controls.
   */
  private scheduleMainLoop(): void {
    const loop = async () => {
      if (!this.processRunning) return;

      try {
        const runtimeConfig = await loadLiveArbRuntimeConfig();
        const shouldBeActive = runtimeConfig.liveArbEnabled;

        if (shouldBeActive && !this.arbActive) {
          // Dashboard enabled arb - start it
          liveArbLog('info', WORKER_TAG, 'liveArbEnabled toggled to true – starting arbitrage system');
          await this.startArb(runtimeConfig);
        } else if (!shouldBeActive && this.arbActive) {
          // Dashboard disabled arb - stop it
          liveArbLog('info', WORKER_TAG, 'liveArbEnabled toggled to false – stopping arbitrage system');
          await this.stopArb();
        } else if (this.arbActive) {
          // Already running - do market refresh
          await this.refreshMarkets(this.cachedBotConfig!, runtimeConfig);
        } else {
          // Idle - just record heartbeat
          await this.recordHeartbeat('IDLE', runtimeConfig);
        }
      } catch (error) {
        liveArbLog('error', WORKER_TAG, 'Error in main loop', error as Error);
      }

      // Schedule next iteration
      const interval = this.arbActive ? this.refreshIntervalMs : IDLE_POLL_INTERVAL_MS;
      this.refreshTimer = setTimeout(loop, interval);
    };

    // Start immediately
    loop();
  }

  private async refreshMarkets(
    botConfig: BotConfig,
    runtimeConfig: LiveArbRuntimeConfig
  ): Promise<void> {
    try {
      // Build filters with runtime config for liveEventsOnly and sportsOnly
      const filters = this.marketFetcher.buildFiltersFromConfig(botConfig, runtimeConfig);
      const results = await this.marketFetcher.fetchAllPlatforms(filters);
      const markets = Object.values(results).flatMap((r) => r.markets);

      await refreshRegistry(markets);

      liveArbLog('debug', WORKER_TAG, 'Registry refresh complete', {
        totalMarkets: markets.length,
        liveOnly: runtimeConfig.liveEventsOnly,
        sportsOnly: runtimeConfig.sportsOnly,
        perPlatform: Object.fromEntries(
          Object.entries(results).map(([platform, result]) => [
            platform,
            result.markets.length,
          ])
        ),
      });

      if (markets.length === 0) {
        liveArbLog(
          'warn',
          WORKER_TAG,
          'Registry refresh returned 0 markets – rule-based matcher will have nothing to process'
        );
      }
      await this.recordHeartbeat('RUNNING', runtimeConfig, { totalMarkets: markets.length });
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Registry refresh failed', error as Error);
    }
  }

  private async recordHeartbeat(
    state: LiveArbWorkerHeartbeat['state'],
    runtimeConfig?: LiveArbRuntimeConfig,
    meta?: { totalMarkets?: number }
  ): Promise<void> {
    try {
      // Collect platform statuses from LiveArbManager (source of truth when worker is running)
      const wsStatuses = LiveArbManager.getWsStatuses();
      const platforms = {
        sxbet: this.formatPlatformStatusForKV(wsStatuses.sxbet, 'sxbet'),
        polymarket: this.formatPlatformStatusForKV(wsStatuses.polymarket, 'polymarket'),
        kalshi: this.formatPlatformStatusForKV(wsStatuses.kalshi, 'kalshi'),
      };

      // Collect price cache stats
      const cacheStats = LivePriceCache.getStats();
      const pricesByPlatform = LivePriceCache.getPriceCountByPlatform();
      const allPrices = LivePriceCache.getAllPrices();

      // Calculate age range
      let oldestUpdateMs: number | undefined;
      let newestUpdateMs: number | undefined;
      let lastPriceUpdateAt: string | undefined;

      for (const price of allPrices) {
        const ageMs = price.ageMs ?? 0;
        if (oldestUpdateMs === undefined || ageMs > oldestUpdateMs) {
          oldestUpdateMs = ageMs;
        }
        if (newestUpdateMs === undefined || ageMs < newestUpdateMs) {
          newestUpdateMs = ageMs;
          lastPriceUpdateAt = price.updatedAt;
        }
      }

      const priceCacheStats: WorkerPriceCacheStats = {
        totalEntries: cacheStats.priceCacheSize,
        entriesByPlatform: pricesByPlatform,
        totalPriceUpdates: cacheStats.totalPriceUpdates,
        oldestUpdateMs,
        newestUpdateMs,
        lastPriceUpdateAt,
      };

      // Get circuit breaker state
      const status = getLiveArbStatus();
      const circuitBreaker = {
        isOpen: status.safetyStatus.circuitBreakerOpen,
        consecutiveFailures: status.safetyStatus.circuitBreakerState.consecutiveFailures,
        openReason: status.safetyStatus.circuitBreakerState.openReason,
        openedAt: status.safetyStatus.circuitBreakerState.openedAt,
      };

      await updateWorkerHeartbeat({
        updatedAt: new Date().toISOString(),
        state,
        liveArbEnabled: runtimeConfig?.liveArbEnabled,
        ruleBasedMatcherEnabled: runtimeConfig?.ruleBasedMatcherEnabled,
        liveEventsOnly: runtimeConfig?.liveEventsOnly,
        sportsOnly: runtimeConfig?.sportsOnly,
        refreshIntervalMs: this.refreshIntervalMs,
        totalMarkets: meta?.totalMarkets,
        platforms,
        priceCacheStats,
        circuitBreaker,
      });
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Failed to write worker heartbeat', error as Error);
    }
  }

  /**
   * Convert WsClientStatus to WorkerPlatformStatus for KV storage.
   * Handles null/undefined status and adds disabled state detection.
   */
  private formatPlatformStatusForKV(
    status: WsClientStatus | null,
    platform: 'sxbet' | 'polymarket' | 'kalshi'
  ): WorkerPlatformStatus {
    // Check for disabled platforms (missing env vars)
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
        state: this.arbActive ? 'connecting' : 'not_initialized',
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
      logLevel: process.env.LIVE_ARB_LOG_LEVEL || 'info',
    });
  }
}

function balanceArrayToMap(
  balances: AccountBalance[]
): Record<'kalshi' | 'polymarket' | 'sxbet', number> {
  const map = {
    kalshi: 0,
    polymarket: 0,
    sxbet: 0,
  };

  for (const balance of balances) {
    map[balance.platform] =
      balance.availableCash ?? balance.balance ?? map[balance.platform];
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
      cancelOrder: async () => {
        // Polymarket cancel support TODO
      },
    },
    sxbet: {
      placeBet: (marketId, ticker, side, price, quantity) =>
        sxBetApi.placeBet(marketId, side, price, quantity),
      cancelOrder: async () => {
        // SX.bet cancel support TODO
      },
    },
  };
}

const worker = new LiveArbWorker(DEFAULT_REFRESH_INTERVAL_MS);

worker.start().catch((error) => {
  liveArbLog('error', WORKER_TAG, 'Live-arb worker failed to start', error as Error);
  process.exit(1);
});

process.on('SIGINT', () => {
  liveArbLog('info', WORKER_TAG, 'Received SIGINT, shutting down...');
  worker.shutdown().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  liveArbLog('info', WORKER_TAG, 'Received SIGTERM, shutting down...');
  worker.shutdown().finally(() => process.exit(0));
});
