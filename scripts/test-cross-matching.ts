import { Market } from '@/types';
import { scanArbitrageOpportunities } from '../lib/arbitrage';

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const sharedTitle =
  'Will Bitcoin close at or above $100k on 2025-12-31?';

const kalshiMarket: Market = {
  id: 'kalshi-btc-100k',
  ticker: 'BTC100K',
  platform: 'kalshi',
  marketType: 'prediction',
  title: sharedTitle,
  yesPrice: 48,
  noPrice: 52,
  expiryDate: futureDate,
  volume: 1000,
};

const polymarketMarket: Market = {
  id: 'polymarket-btc-100k',
  ticker: 'POLY-BTC-100K',
  platform: 'polymarket',
  marketType: 'prediction',
  title: sharedTitle,
  yesPrice: 51,
  noPrice: 49,
  expiryDate: futureDate,
  volume: 800,
};

const sxbetMarket: Market = {
  id: 'sxbet-btc-100k',
  ticker: 'SX-BTC-100K',
  platform: 'sxbet',
  marketType: 'sportsbook',
  title: sharedTitle,
  yesPrice: 1.95,
  noPrice: 1.9,
  expiryDate: futureDate,
  volume: 0,
};

console.log('🧪 Testing cross-platform matching and arbitrage scanning...\n');

const predictionResults = scanArbitrageOpportunities(
  [kalshiMarket],
  [polymarketMarket],
  0.1,
  { label: 'prediction-test', silent: false }
);

if (predictionResults.matchCount === 0) {
  throw new Error('Expected at least one Kalshi vs Polymarket match');
}

const sportsbookResults = scanArbitrageOpportunities(
  [polymarketMarket],
  [sxbetMarket],
  0.1,
  { label: 'mixed-test', silent: false }
);

if (sportsbookResults.matchCount === 0) {
  throw new Error('Expected at least one Polymarket vs SX.bet match');
}

console.log('\n✅ Cross-platform matching test complete.');
console.log(
  `Prediction matches: ${predictionResults.matchCount}, profitable: ${predictionResults.profitableCount}`
);
console.log(
  `Mixed matches: ${sportsbookResults.matchCount}, profitable: ${sportsbookResults.profitableCount}`
);

