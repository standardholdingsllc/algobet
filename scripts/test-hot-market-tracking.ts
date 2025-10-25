/**
 * Test script for Hot Market Tracking System
 * 
 * Demonstrates how the bot tracks markets across multiple platforms
 * and constantly monitors all combinations for arbitrage opportunities.
 */

import { HotMarketTracker } from '../lib/hot-market-tracker';
import { Market } from '../types';

console.log('🧪 Testing Hot Market Tracking System\n');
console.log('='.repeat(60));

// Create tracker instance
const tracker = new HotMarketTracker();

// Simulate markets from different platforms
const testMarkets: Market[] = [
  // Yankees vs Red Sox - Available on all 3 platforms
  {
    id: 'kalshi-yankees-1',
    ticker: 'kalshi-yankees-1',
    platform: 'kalshi',
    marketType: 'prediction',
    title: 'Yankees to win vs Red Sox',
    yesPrice: 65,
    noPrice: 35,
    expiryDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
    volume: 0,
  },
  {
    id: 'poly-yankees-1',
    ticker: 'poly-yankees-1',
    platform: 'polymarket',
    marketType: 'prediction',
    title: 'Will the Yankees beat the Red Sox?',
    yesPrice: 68,
    noPrice: 32,
    expiryDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    volume: 0,
  },
  {
    id: 'sx-yankees-1',
    ticker: 'sx-yankees-1',
    platform: 'sxbet',
    marketType: 'sportsbook',
    title: 'New York Yankees vs Boston Red Sox (Moneyline)',
    yesPrice: 1.52, // Decimal odds
    noPrice: 2.75,
    expiryDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    volume: 0,
  },

  // Lakers vs Celtics - Available on Polymarket and SX.bet only
  {
    id: 'poly-lakers-1',
    ticker: 'poly-lakers-1',
    platform: 'polymarket',
    marketType: 'prediction',
    title: 'Lakers to win tonight vs Celtics',
    yesPrice: 55,
    noPrice: 45,
    expiryDate: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), // 1 hour
    volume: 0,
  },
  {
    id: 'sx-lakers-1',
    ticker: 'sx-lakers-1',
    platform: 'sxbet',
    marketType: 'sportsbook',
    title: 'Los Angeles Lakers vs Boston Celtics',
    yesPrice: 1.85,
    noPrice: 1.95,
    expiryDate: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(),
    volume: 0,
  },

  // Bitcoin price - Only on Kalshi (not tracked)
  {
    id: 'kalshi-btc-1',
    ticker: 'kalshi-btc-1',
    platform: 'kalshi',
    marketType: 'prediction',
    title: 'Bitcoin price above $50k at end of month',
    yesPrice: 70,
    noPrice: 30,
    expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days
    volume: 0,
  },
];

console.log('\n📊 INITIAL MARKETS');
console.log('='.repeat(60));
console.log(`Total markets: ${testMarkets.length}`);
console.log('  - 3 for Yankees vs Red Sox (Kalshi, Polymarket, SX.bet)');
console.log('  - 2 for Lakers vs Celtics (Polymarket, SX.bet)');
console.log('  - 1 for Bitcoin price (Kalshi only)');

// Add markets to tracker
console.log('\n🎯 ADDING MARKETS TO TRACKER');
console.log('='.repeat(60));
tracker.addMarkets(testMarkets);

// Get stats
const stats1 = tracker.getStats();
console.log(`\nTracking Status:`);
console.log(`  - Total tracked markets: ${stats1.totalTracked}`);
console.log(`  - Live tracked markets: ${stats1.liveTracked}`);
console.log(`  - Platform combinations: ${stats1.totalPlatformCombinations}`);

// Get all tracked markets
const trackedMarkets = tracker.getAllTrackedMarkets();
console.log('\n📋 TRACKED MARKETS DETAIL');
console.log('='.repeat(60));

for (const market of trackedMarkets) {
  console.log(`\n${market.displayTitle}`);
  console.log(`  Platforms: ${market.platforms.map(p => p.platform).join(', ')}`);
  console.log(`  Combinations to check: ${tracker.getAllCombinations(market).length}`);
  console.log(`  Live event: ${market.isLive ? '🔴 YES' : '⚪ NO'}`);
  console.log(`  Expires: ${new Date(market.expiryDate).toLocaleString()}`);
}

// Show combinations for Yankees game
console.log('\n\n🔄 PLATFORM COMBINATIONS FOR YANKEES GAME');
console.log('='.repeat(60));

const yankeesMarket = trackedMarkets.find(m => m.displayTitle.toLowerCase().includes('yankees'));
if (yankeesMarket) {
  const combinations = tracker.getAllCombinations(yankeesMarket);
  console.log(`\nChecking ${combinations.length} combinations every scan:\n`);
  
  for (let i = 0; i < combinations.length; i++) {
    const [m1, m2] = combinations[i];
    console.log(`${i + 1}. ${m1.platform.toUpperCase()} vs ${m2.platform.toUpperCase()}`);
    console.log(`   ${m1.platform}: Yes=${m1.yesPrice}, No=${m1.noPrice}`);
    console.log(`   ${m2.platform}: Yes=${m2.yesPrice}, No=${m2.noPrice}`);
    console.log('');
  }
}

// Simulate market update (odds changed)
console.log('\n⏱️  SIMULATING MARKET UPDATE (5 seconds later)');
console.log('='.repeat(60));
console.log('Yankees odds changed on Kalshi and SX.bet!\n');

const updatedMarkets: Market[] = [
  {
    ...testMarkets[0],
    yesPrice: 63, // Changed from 65
    noPrice: 37,
  },
  {
    ...testMarkets[1],
    // Polymarket unchanged
  },
  {
    ...testMarkets[2],
    yesPrice: 1.55, // Changed from 1.52
    noPrice: 2.65,
  },
  ...testMarkets.slice(3), // Rest unchanged
];

tracker.addMarkets(updatedMarkets);
console.log('✅ Updated tracked markets with new odds');

// Show tracked market stats
console.log('\n\n📈 TRACKING STATISTICS');
console.log('='.repeat(60));

const stats2 = tracker.getStats();
console.log(`Total markets tracked: ${stats2.totalTracked}`);
console.log(`Live events tracked: ${stats2.liveTracked}`);
console.log(`Platform combinations: ${stats2.totalPlatformCombinations}`);

if (stats2.topMarkets.length > 0) {
  console.log('\n🏆 Top Markets by Opportunities Found:');
  stats2.topMarkets.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.title}`);
    console.log(`     Platforms: ${m.platforms}, Opportunities: ${m.opportunities}`);
  });
}

// Simulate market expiry
console.log('\n\n⏰ SIMULATING MARKET EXPIRY');
console.log('='.repeat(60));

// Create expired market (past expiry date)
const expiredMarket: Market = {
  id: 'expired-1',
  ticker: 'expired-1',
  platform: 'kalshi',
  marketType: 'prediction',
  title: 'Test expired market',
  yesPrice: 50,
  noPrice: 50,
  expiryDate: new Date(Date.now() - 1000).toISOString(), // 1 second ago
  volume: 0,
};

tracker.addMarkets([expiredMarket, ...updatedMarkets]);
console.log('Added expired market to tracker');

const removedCount = tracker.removeExpired();
console.log(`✅ Removed ${removedCount} expired market(s)`);

const finalStats = tracker.getStats();
console.log(`\nFinal tracking count: ${finalStats.totalTracked} markets`);

// Summary
console.log('\n\n' + '='.repeat(60));
console.log('✅ TEST COMPLETE');
console.log('='.repeat(60));
console.log('\nKey Takeaways:');
console.log('  1. Markets on 2+ platforms are automatically tracked');
console.log('  2. All platform combinations are monitored every scan');
console.log('  3. Live events (expiring soon) are flagged for priority');
console.log('  4. Expired markets are automatically removed');
console.log('  5. Single-platform markets are NOT tracked (no arb possible)');
console.log('\n🎯 This ensures we NEVER miss an arbitrage opportunity during live events!\n');

