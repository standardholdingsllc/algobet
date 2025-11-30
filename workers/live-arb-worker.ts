import { MarketFeedService } from '../lib/market-feed-service';
import { KVStorage } from '../lib/kv-storage';
import { BotConfig, AccountBalance } from '@/types';
import { LiveArbManager } from '../lib/live-arb-manager';
import { loadLiveArbRuntimeConfig } from '../lib/live-arb-runtime-config';
import { buildLiveArbConfig } from '../lib/live-arb-integration';
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

const WORKER_TAG = 'LiveArbWorker';
const DEFAULT_REFRESH_INTERVAL_MS = parseInt(
  process.env.LIVE_ARB_WORKER_REFRESH_MS || '15000',
  10
);

class LiveArbWorker {
  private feedService = new MarketFeedService();
  private running = false;
  private refreshTimer: NodeJS.Timeout | null = null;
  private adapters: PlatformAdapters;

  constructor(private refreshIntervalMs: number) {
    this.adapters = buildPlatformAdapters();
  }

  async start(): Promise<void> {
    liveArbLog('info', WORKER_TAG, 'Starting live-arb worker (script-managed)', {
      pid: process.pid,
      nodeEnv: process.env.NODE_ENV || 'unknown',
    });

    try {
      const runtimeConfig = await loadLiveArbRuntimeConfig();
      if (!runtimeConfig.liveArbEnabled) {
        liveArbLog(
          'info',
          WORKER_TAG,
          'liveArbEnabled=false in KV; not starting WS clients / orchestrator (run /api/live-arb/config to enable).'
        );
        return;
      }

      const botConfig = await KVStorage.getConfig();
      const liveArbConfig = buildLiveArbConfig(botConfig, runtimeConfig);

      await LiveArbManager.initialize(liveArbConfig);

      const executionOptions = await this.buildExecutionOptions(botConfig);
      await startOrchestrator(this.adapters, executionOptions);

      this.logExecutionMode(botConfig);

      this.running = true;
      await this.refreshMarkets(botConfig);
      this.scheduleLoop(botConfig);
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Failed to start live-arb worker', error as Error);
      await this.stop();
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    await stopOrchestrator();
    await LiveArbManager.shutdown();
    liveArbLog('info', WORKER_TAG, 'Stopped live-arb worker');
  }

  private scheduleLoop(botConfig: BotConfig): void {
    const loop = async () => {
      if (!this.running) return;
      await this.refreshMarkets(botConfig);
      this.refreshTimer = setTimeout(loop, this.refreshIntervalMs);
    };

    this.refreshTimer = setTimeout(loop, this.refreshIntervalMs);
  }

  private async refreshMarkets(botConfig: BotConfig): Promise<void> {
    try {
      const filters = this.feedService.buildFiltersFromConfig(botConfig);
      const results = await this.feedService.fetchLiveMarketsForPlatforms(filters);
      const markets = Object.values(results).flatMap(({ markets }) => markets);

      await refreshRegistry(markets);

      liveArbLog('debug', WORKER_TAG, 'Registry refresh complete', {
        totalMarkets: markets.length,
        perPlatform: Object.fromEntries(
          Object.entries(results).map(([platform, { markets }]) => [
            platform,
            markets.length,
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
    } catch (error) {
      liveArbLog('error', WORKER_TAG, 'Registry refresh failed', error as Error);
    }
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
  worker.stop().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  worker.stop().finally(() => process.exit(0));
});

