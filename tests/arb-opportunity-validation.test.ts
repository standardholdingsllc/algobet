/**
 * Arb Opportunity Validation Tests
 *
 * Verification harness to ensure:
 * 1. Time-travel simulation: No false positives when prices are never simultaneously profitable
 * 2. Valid opportunity detection: Exactly 1 opportunity when both legs are profitable with low skew
 * 3. Regression test: All logged opportunities satisfy freshness constraints
 *
 * Run with: npx vitest run tests/arb-opportunity-validation.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArbitrageOpportunity, Market, MarketPlatform } from '@/types';
import { scanArbitrageOpportunities } from '@/lib/arbitrage';
import {
  createArbOpportunityLog,
  ArbOpportunityLog,
} from '@/lib/arb-opportunity-logger';

// ============================================================================
// Configuration Constants (should match live-arb-manager.ts)
// ============================================================================

const MAX_PRICE_AGE_MS = 2000; // Maximum age of a price to be considered valid
const MAX_SKEW_MS = 500; // Maximum time skew between legs

// ============================================================================
// Test Helpers
// ============================================================================

function createMockMarket(
  platform: MarketPlatform,
  id: string,
  yesPrice: number,
  noPrice: number,
  oddsAsOf?: string,
  title?: string
): Market {
  return {
    id,
    ticker: id,
    platform,
    marketType: 'prediction',
    title: title || `Test Market ${id}`,
    yesPrice,
    noPrice,
    expiryDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    volume: 1000,
    liquidity: 500,
    oddsAsOf,
  };
}

function createMockOpportunity(
  market1: Market,
  market2: Market,
  side1: 'yes' | 'no',
  side2: 'yes' | 'no',
  profitMargin: number
): ArbitrageOpportunity {
  return {
    id: `opp-${Date.now()}`,
    market1,
    market2,
    side1,
    side2,
    profitMargin,
    profitPercentage: profitMargin,
    betSize1: 50,
    betSize2: 50,
    expectedProfit: profitMargin * 100,
    netProfit: profitMargin * 100,
    timestamp: new Date(),
  };
}

// ============================================================================
// Time Travel Simulation Tests
// ============================================================================

describe('Time Travel Arb Simulation', () => {
  describe('No False Positives', () => {
    it('should produce 0 opportunities when prices are never simultaneously profitable', () => {
      /**
       * Simulation:
       * - t=0: Platform A has profitable price (yes=30), Platform B does not (yes=75)
       * - t=5s: Platform B becomes profitable (yes=30), Platform A is no longer profitable (yes=75)
       * - At no point are both platforms profitable at the same time
       */

      // Simulate t=0: Only Platform A is profitable
      const t0 = new Date();
      const marketA_t0 = createMockMarket(
        'kalshi',
        'market-a',
        30, // yes price - profitable
        70, // no price
        t0.toISOString()
      );
      const marketB_t0 = createMockMarket(
        'polymarket',
        'market-b',
        75, // yes price - not profitable
        25, // no price
        t0.toISOString()
      );

      // At t=0, scan should find no arb (30 + 75 = 105 > 100)
      const result_t0 = scanArbitrageOpportunities(
        [marketA_t0],
        [marketB_t0],
        0.1, // 0.1% min profit
        { label: 'test-t0', silent: true }
      );

      expect(result_t0.opportunities.length).toBe(0);

      // Simulate t=5s: Only Platform B is profitable, Platform A is stale/changed
      const t5 = new Date(t0.getTime() + 5000);
      const marketA_t5 = createMockMarket(
        'kalshi',
        'market-a',
        75, // yes price - no longer profitable
        25, // no price
        t5.toISOString()
      );
      const marketB_t5 = createMockMarket(
        'polymarket',
        'market-b',
        30, // yes price - now profitable
        70, // no price
        t5.toISOString()
      );

      // At t=5s, scan should find no arb (75 + 30 = 105 > 100)
      const result_t5 = scanArbitrageOpportunities(
        [marketA_t5],
        [marketB_t5],
        0.1,
        { label: 'test-t5', silent: true }
      );

      expect(result_t5.opportunities.length).toBe(0);

      // Mixed timestamps (stale price scenario) - should not create false positive
      // If we accidentally use t0's A price with t5's B price
      const result_mixed = scanArbitrageOpportunities(
        [marketA_t0], // Old profitable price
        [marketB_t5], // New profitable price
        0.1,
        { label: 'test-mixed', silent: true }
      );

      // Even if scan finds it, the log should show high skew
      if (result_mixed.opportunities.length > 0) {
        const log = createArbOpportunityLog(result_mixed.opportunities[0], {
          matchupKey: 'test-matchup',
          priceTimestampA: t0.toISOString(),
          priceTimestampB: t5.toISOString(),
        });

        // The time skew should be 5000ms, which exceeds MAX_SKEW_MS
        expect(log.timeSkewMs).toBe(5000);
        expect(log.timeSkewMs).toBeGreaterThan(MAX_SKEW_MS);
      }
    });
  });

  describe('Valid Opportunity Detection', () => {
    it('should detect exactly 1 opportunity when both legs are profitable at t=2s with skew < 500ms', () => {
      /**
       * Simulation:
       * - t=2s: Both platforms have profitable prices with minimal skew
       * - Platform A: yes=35 (implies no=65 for fair market, but we set no=65)
       * - Platform B: yes=70, no=30 (mispriced - no is cheap)
       * - Arb: Buy YES on A at 35, buy NO on B at 30 = 65 total cost for guaranteed $100 payout
       * - Profit: $35 (35%)
       *
       * For the scanner to find this, we need the prices to sum to less than 100:
       * A.yes + B.no < 100 OR A.no + B.yes < 100
       *
       * IMPORTANT: Both markets must have the SAME title for the matcher to find them!
       */

      const baseTime = new Date();
      const t2_000 = new Date(baseTime.getTime() + 2000);
      const t2_200 = new Date(baseTime.getTime() + 2200);

      const sharedTitle = 'Will Lakers win vs Celtics?';

      // Market A: yes=35, no=65 (fair pricing)
      const marketA = createMockMarket(
        'kalshi',
        'market-a',
        35, // yes price
        65, // no price
        t2_000.toISOString(),
        sharedTitle
      );

      // Market B: yes=70, no=30 (mispriced - no is too cheap!)
      // Arb: Buy A.yes at 35 + B.no at 30 = 65 total, payout 100, profit 35%
      const marketB = createMockMarket(
        'polymarket',
        'market-b',
        70, // yes price
        30, // no price - cheap!
        t2_200.toISOString(),
        sharedTitle
      );

      // Scan for opportunities
      const result = scanArbitrageOpportunities(
        [marketA],
        [marketB],
        0.1, // 0.1% min profit
        { label: 'test-valid', silent: true }
      );

      expect(result.opportunities.length).toBe(1);

      const opp = result.opportunities[0];
      expect(opp.profitMargin).toBeGreaterThan(0);

      // Create log and verify skew
      const log = createArbOpportunityLog(opp, {
        matchupKey: 'test-matchup',
        priceTimestampA: t2_000.toISOString(),
        priceTimestampB: t2_200.toISOString(),
      });

      expect(log.timeSkewMs).toBe(200);
      expect(log.timeSkewMs).toBeLessThanOrEqual(MAX_SKEW_MS);
    });
  });
});

// ============================================================================
// Regression Tests for Logged Opportunities
// ============================================================================

describe('Logged Opportunity Constraints', () => {
  describe('Freshness Validation', () => {
    it('should flag opportunities with stale prices (ageMsA > MAX_PRICE_AGE_MS)', () => {
      const now = new Date();
      const staleTime = new Date(now.getTime() - 3000); // 3 seconds ago

      const market1 = createMockMarket(
        'kalshi',
        'market-1',
        40,
        60,
        staleTime.toISOString()
      );
      const market2 = createMockMarket(
        'polymarket',
        'market-2',
        45,
        55,
        now.toISOString()
      );

      const opp = createMockOpportunity(market1, market2, 'yes', 'no', 0.05);

      const log = createArbOpportunityLog(opp, {
        matchupKey: 'test',
        priceTimestampA: staleTime.toISOString(),
        priceTimestampB: now.toISOString(),
      });

      // Age should exceed MAX_PRICE_AGE_MS
      expect(log.ageMsA).toBeGreaterThan(MAX_PRICE_AGE_MS);
    });

    it('should flag opportunities with stale prices (ageMsB > MAX_PRICE_AGE_MS)', () => {
      const now = new Date();
      const staleTime = new Date(now.getTime() - 5000); // 5 seconds ago

      const market1 = createMockMarket(
        'kalshi',
        'market-1',
        40,
        60,
        now.toISOString()
      );
      const market2 = createMockMarket(
        'polymarket',
        'market-2',
        45,
        55,
        staleTime.toISOString()
      );

      const opp = createMockOpportunity(market1, market2, 'yes', 'no', 0.05);

      const log = createArbOpportunityLog(opp, {
        matchupKey: 'test',
        priceTimestampA: now.toISOString(),
        priceTimestampB: staleTime.toISOString(),
      });

      // Age should exceed MAX_PRICE_AGE_MS
      expect(log.ageMsB).toBeGreaterThan(MAX_PRICE_AGE_MS);
    });

    it('should flag opportunities with excessive time skew', () => {
      const now = new Date();
      const skewedTime = new Date(now.getTime() - 1000); // 1 second skew

      const market1 = createMockMarket('kalshi', 'market-1', 40, 60, now.toISOString());
      const market2 = createMockMarket(
        'polymarket',
        'market-2',
        45,
        55,
        skewedTime.toISOString()
      );

      const opp = createMockOpportunity(market1, market2, 'yes', 'no', 0.05);

      const log = createArbOpportunityLog(opp, {
        matchupKey: 'test',
        priceTimestampA: now.toISOString(),
        priceTimestampB: skewedTime.toISOString(),
      });

      // Skew should exceed MAX_SKEW_MS
      expect(log.timeSkewMs).toBeGreaterThan(MAX_SKEW_MS);
    });
  });

  describe('Valid Opportunity Assertions', () => {
    it('every valid opportunity should satisfy freshness constraints', () => {
      const now = new Date();
      const recentTime = new Date(now.getTime() - 100); // 100ms ago

      const market1 = createMockMarket(
        'kalshi',
        'market-1',
        40,
        60,
        now.toISOString()
      );
      const market2 = createMockMarket(
        'polymarket',
        'market-2',
        45,
        55,
        recentTime.toISOString()
      );

      const opp = createMockOpportunity(market1, market2, 'yes', 'no', 0.05);

      const log = createArbOpportunityLog(opp, {
        matchupKey: 'test',
        priceTimestampA: now.toISOString(),
        priceTimestampB: recentTime.toISOString(),
      });

      // All constraints should be satisfied
      expect(log.ageMsA).toBeLessThanOrEqual(MAX_PRICE_AGE_MS);
      expect(log.ageMsB).toBeLessThanOrEqual(MAX_PRICE_AGE_MS);
      expect(log.timeSkewMs).toBeLessThanOrEqual(MAX_SKEW_MS);
    });
  });
});

// ============================================================================
// CSV Export Field Validation
// ============================================================================

describe('ArbOpportunityLog Fields', () => {
  it('should include all required audit fields', () => {
    const now = new Date();
    const market1 = createMockMarket('kalshi', 'market-1', 40, 60, now.toISOString());
    const market2 = createMockMarket('polymarket', 'market-2', 45, 55, now.toISOString());
    const opp = createMockOpportunity(market1, market2, 'yes', 'no', 0.05);

    const log = createArbOpportunityLog(opp, {
      matchupKey: 'test-matchup',
      priceTimestampA: now.toISOString(),
      priceTimestampB: now.toISOString(),
    });

    // Identity fields
    expect(log.detectedAt).toBeDefined();
    expect(log.opportunityId).toBeDefined();

    // Event info
    expect(log.matchupKey).toBe('test-matchup');
    expect(log.marketKind).toBe('prediction');

    // Leg A fields
    expect(log.platformA).toBe('kalshi');
    expect(log.marketIdA).toBe('market-1');
    expect(log.outcomeA).toBeDefined();
    expect(log.sideA).toBeDefined();
    expect(log.rawPriceA).toBe(40);
    expect(log.impliedProbA).toBeDefined();
    expect(log.asOfA).toBeDefined();
    expect(log.ageMsA).toBeDefined();

    // Leg B fields
    expect(log.platformB).toBe('polymarket');
    expect(log.marketIdB).toBe('market-2');
    expect(log.outcomeB).toBeDefined();
    expect(log.sideB).toBeDefined();
    expect(log.rawPriceB).toBe(55); // no price since side is 'no'
    expect(log.impliedProbB).toBeDefined();
    expect(log.asOfB).toBeDefined();
    expect(log.ageMsB).toBeDefined();

    // Timing
    expect(log.timeSkewMs).toBeDefined();

    // Financials
    expect(log.payoutTarget).toBe(100);
    expect(log.totalCost).toBeDefined();
    expect(log.profitAbs).toBeDefined();
    expect(log.profitPct).toBeDefined();

    // Fees
    expect(log.feesA).toBeDefined();
    expect(log.feesB).toBeDefined();

    // Metadata
    expect(log.workerVersion).toBeDefined();
  });
});

