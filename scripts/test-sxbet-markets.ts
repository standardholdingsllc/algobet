import { MarketFeedService } from '@/lib/market-feed-service';
import { BotConfig } from '@/types';

const args = process.argv.slice(2);
const maxDaysArg = Number(args.find((arg) => !arg.startsWith('--')));
const maxDaysToExpiry =
  Number.isFinite(maxDaysArg) && maxDaysArg > 0 ? maxDaysArg : 10;
const runTwice = args.includes('--twice');

async function main(): Promise<void> {
  const service = new MarketFeedService();

  const config: BotConfig = {
    maxBetPercentage: 10,
    maxDaysToExpiry,
    minProfitMargin: 0.5,
    balanceThresholds: {
      kalshi: 0,
      polymarket: 0,
      sxbet: 0,
    },
    emailAlerts: {
      enabled: false,
      lowBalanceAlert: false,
    },
    simulationMode: true,
    marketFilters: {},
  };

  await executeRun(service, config, 'run-1', runTwice);

  if (runTwice) {
    console.log('\n--- Re-running to demonstrate odds reuse ---\n');
    // Give the snapshot store a brief moment to settle.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await executeRun(service, config, 'run-2');
  }
}

async function executeRun(
  service: MarketFeedService,
  config: BotConfig,
  label: string,
  persistSnapshot: boolean = false
): Promise<void> {
  const filters = service.buildFiltersFromConfig(config);
  console.log(
    `[SX.bet Test][${label}] window=${filters.windowStart} → ${filters.windowEnd}`
  );

  const result = await service.fetchLiveMarketsForPlatform('sxbet', filters);
  const stats = service.getSxBetFetchStats();

  if (stats) {
    console.log(
      `[SX.bet Test][${label}] raw=${stats.rawMarkets}, within=${stats.withinWindow}, hydrated=${stats.hydratedWithOdds}, reused=${stats.reusedOdds}, stop=${stats.stopReason}`
    );
  } else {
    console.log(
      `[SX.bet Test][${label}] Adapter did not report fetch stats (likely due to earlier failure).`
    );
  }

  console.log(
    `[SX.bet Test][${label}] markets with odds after filter=${result.markets.length}`
  );

  if (persistSnapshot) {
    console.log(
      `[SX.bet Test][${label}] Persisting snapshot to enable reuse on the next run...`
    );
    await service.persistSnapshots(
      { sxbet: result },
      filters,
      config.maxDaysToExpiry,
      'test-sxbet-markets'
    );
  }
}

main().catch((err) => {
  console.error('[SX.bet Test] Failed:', err);
  process.exit(1);
});

