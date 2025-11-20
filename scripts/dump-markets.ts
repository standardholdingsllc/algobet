import { KalshiAPI } from '@/lib/markets/kalshi';
import { PolymarketAPI } from '@/lib/markets/polymarket';
import { SXBetAPI } from '@/lib/markets/sxbet';
import { saveMarketSnapshots } from '@/lib/market-snapshots';

async function run(): Promise<void> {
  const maxDaysArg = Number(process.argv[2]);
  const maxDaysToExpiry = Number.isFinite(maxDaysArg) && maxDaysArg > 0 ? maxDaysArg : 5;

  console.log(`Dumping markets with maxDaysToExpiry=${maxDaysToExpiry}...`);

  const kalshi = new KalshiAPI();
  const polymarket = new PolymarketAPI();
  const sxbet = new SXBetAPI();

  const [kalshiMarkets, polymarketMarkets, sxbetMarkets] = await Promise.all([
    kalshi.getOpenMarkets(maxDaysToExpiry),
    polymarket.getOpenMarkets(maxDaysToExpiry),
    sxbet.getOpenMarkets(maxDaysToExpiry),
  ]);

  await saveMarketSnapshots(
    {
      kalshi: kalshiMarkets,
      polymarket: polymarketMarkets,
      sxbet: sxbetMarkets,
    },
    { maxDaysToExpiry }
  );

  console.log('✅ Market snapshots written to data/market-snapshots/');
}

run().catch((err) => {
  console.error('❌ Failed to dump markets:', err);
  process.exit(1);
});

