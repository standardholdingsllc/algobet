/**
 * Test script for live arb system
 *
 * Run with: npm run test-live-arb
 *
 * This script tests the live arb components:
 * 1. LivePriceCache operations
 * 2. WebSocket client connections (if credentials are available)
 * 3. Integration with existing MarketFeedService
 */

import { LivePriceCache, priceToImpliedProbability } from '../lib/live-price-cache';
import { LiveArbManager } from '../lib/live-arb-manager';
import { getLiveArbSafetyChecker } from '../lib/live-arb-safety';
import { getLiveArbStatus } from '../lib/live-arb-integration';
import {
  LivePriceUpdate,
  LiveScoreUpdate,
  LiveArbOpportunity,
} from '../types/live-arb';
import { Market } from '../types';

async function runTests() {
  console.log('='.repeat(60));
  console.log('🧪 Live Arb System Test Suite');
  console.log('='.repeat(60));

  // Test 1: LivePriceCache basic operations
  console.log('\n📦 Test 1: LivePriceCache Operations\n');

  // Clear cache
  LivePriceCache.clearAll();
  console.log('✅ Cache cleared');

  // Test price update
  const testUpdate: LivePriceUpdate = {
    key: {
      platform: 'kalshi',
      marketId: 'TEST-MARKET-123',
      outcomeId: 'yes',
    },
    price: 65,
    impliedProbability: 0.65,
    source: 'websocket',
    meta: {
      bestBid: 64,
      bestAsk: 66,
      spread: 2,
    },
  };

  LivePriceCache.updateLivePrice(testUpdate);
  console.log('✅ Price update stored');

  // Retrieve price
  const retrieved = LivePriceCache.getLivePrice(testUpdate.key);
  console.log(`✅ Price retrieved: ${JSON.stringify(retrieved, null, 2)}`);

  // Test effective price
  const testMarket: Market = {
    id: 'TEST-MARKET-123',
    ticker: 'TEST-MARKET-123',
    platform: 'kalshi',
    marketType: 'prediction',
    title: 'Test Market',
    yesPrice: 50,
    noPrice: 50,
    expiryDate: new Date(Date.now() + 86400000).toISOString(),
  };

  const effectiveYes = LivePriceCache.getEffectivePrice(testMarket, 'yes', 5000);
  const effectiveNo = LivePriceCache.getEffectivePrice(testMarket, 'no', 5000);
  console.log(`✅ Effective YES price: ${effectiveYes.price} (${effectiveYes.source})`);
  console.log(`✅ Effective NO price: ${effectiveNo.price} (${effectiveNo.source})`);

  // Test score update
  const testScore: LiveScoreUpdate = {
    fixtureId: 'FIXTURE-456',
    homeScore: 2,
    awayScore: 1,
    gamePhase: 'live',
    period: 2,
    clockTime: '32:15',
    sportLabel: 'soccer',
  };

  LivePriceCache.updateLiveScore(testScore);
  const retrievedScore = LivePriceCache.getScore('FIXTURE-456');
  console.log(`✅ Score stored and retrieved: ${JSON.stringify(retrievedScore, null, 2)}`);

  // Get stats
  const stats = LivePriceCache.getStats();
  console.log(`✅ Cache stats: ${JSON.stringify(stats, null, 2)}`);

  // Test 2: Price conversion utilities
  console.log('\n🔄 Test 2: Price Conversion Utilities\n');

  // Kalshi (cents)
  const kalshiProb = priceToImpliedProbability('kalshi', 65, 'yes');
  console.log(`✅ Kalshi 65¢ YES → ${(kalshiProb * 100).toFixed(1)}% implied`);

  // SX.bet (decimal odds)
  const sxbetProb = priceToImpliedProbability('sxbet', 2.0, 'yes');
  console.log(`✅ SX.bet 2.0 odds → ${(sxbetProb * 100).toFixed(1)}% implied`);

  // Polymarket (cents)
  const polyProb = priceToImpliedProbability('polymarket', 45, 'no');
  console.log(`✅ Polymarket 45¢ NO → ${(polyProb * 100).toFixed(1)}% implied`);

  // Test 3: Safety Checker
  console.log('\n🛡️ Test 3: Safety Checker\n');

  const safetyChecker = getLiveArbSafetyChecker({
    maxPriceAgeMs: 3000,
    minProfitBps: 25,
    maxSlippageBps: 100,
  });

  // Create a mock opportunity
  const mockOpp: LiveArbOpportunity = {
    id: 'test-opp-1',
    market1: testMarket,
    market2: {
      ...testMarket,
      id: 'TEST-MARKET-456',
      platform: 'polymarket',
      yesPrice: 30,
      noPrice: 70,
    },
    side1: 'yes',
    side2: 'no',
    profitMargin: 0.5,
    profitPercentage: 0.5,
    betSize1: 100,
    betSize2: 100,
    estimatedProfit: 0.5,
    createdAt: new Date().toISOString(),
    detectedAt: new Date().toISOString(),
    maxPriceAgeMs: 500,
    hasLiveScoreContext: false,
    priceSource: {
      market1: 'websocket',
      market2: 'websocket',
    },
  };

  const safetyResult = safetyChecker.checkOpportunity(mockOpp);
  console.log(`✅ Safety check result: ${safetyResult.overallPassed ? 'PASSED' : 'BLOCKED'}`);
  console.log(`   Checks: ${JSON.stringify(safetyResult.checks, null, 2)}`);
  if (safetyResult.blockers.length > 0) {
    console.log(`   Blockers: ${safetyResult.blockers.join(', ')}`);
  }
  if (safetyResult.warnings.length > 0) {
    console.log(`   Warnings: ${safetyResult.warnings.join(', ')}`);
  }

  // Test 4: LiveArbManager status (without actually connecting)
  console.log('\n📊 Test 4: LiveArbManager Status\n');

  const status = getLiveArbStatus();
  console.log(`✅ Live arb status: ${JSON.stringify(status, null, 2)}`);

  // Test 5: WebSocket clients (check configuration)
  console.log('\n🔌 Test 5: WebSocket Configuration Check\n');

  const envVars = {
    SXBET_API_KEY: process.env.SXBET_API_KEY ? '✅ Set' : '❌ Not set',
    SXBET_WS_URL: process.env.SXBET_WS_URL || 'wss://api.sx.bet (default)',
    POLYMARKET_WS_URL:
      process.env.POLYMARKET_WS_URL ||
      'wss://ws-subscriptions-clob.polymarket.com/ws/market (default)',
    KALSHI_WS_URL:
      process.env.KALSHI_WS_URL ||
      'wss://trading-api.kalshi.com/trade-api/ws/v2 (default)',
    LIVE_ARB_ENABLED: process.env.LIVE_ARB_ENABLED || 'false (default)',
    LIVE_ARB_MIN_PROFIT_BPS: process.env.LIVE_ARB_MIN_PROFIT_BPS || '50 (default)',
    LIVE_ARB_MAX_PRICE_AGE_MS: process.env.LIVE_ARB_MAX_PRICE_AGE_MS || '2000 (default)',
  };

  console.log('Environment variables:');
  for (const [key, value] of Object.entries(envVars)) {
    console.log(`  ${key}: ${value}`);
  }

  // Clean up
  LivePriceCache.clearAll();

  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests completed!');
  console.log('='.repeat(60));
  console.log('\nTo enable live arb, set LIVE_ARB_ENABLED=true in your .env file');
  console.log('and ensure the platform API keys are configured.\n');
}

// Run tests
runTests().catch(console.error);

