import { MarketFeedService } from '@/lib/market-feed-service';
import { BotConfig } from '@/types';

async function run(): Promise<void> {
  const maxDaysArg = Number(process.argv[2]);
  const maxDaysToExpiry =
    Number.isFinite(maxDaysArg) && maxDaysArg > 0 ? maxDaysArg : 10;

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

  const filters = service.buildFiltersFromConfig(config);
  console.log(
    `[SX.bet Test] window=${filters.windowStart} → ${filters.windowEnd}`
  );

  const { markets } = await service.fetchLiveMarketsForPlatform(
    'sxbet',
    filters
  );
  const stats = service.getSxBetFetchStats();

  if (stats) {
    console.log(
      `[SX.bet Test] Raw markets=${stats.rawMarkets}, pages=${stats.pagesFetched}, stop=${stats.stopReason}`
    );
    console.log(
      `[SX.bet Test] Within window=${stats.withinWindow}, with USDC odds=${stats.hydratedWithOdds}`
    );
  } else {
    console.log('[SX.bet Test] Adapter did not report fetch stats.');
  }

  console.log(
    `[SX.bet Test] Markets after MarketFeed expiry filter=${markets.length}`
  );
}

run().catch((err) => {
  console.error('[SX.bet Test] Failed:', err);
  process.exit(1);
});

