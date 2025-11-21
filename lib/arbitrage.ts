import { Market, ArbitrageOpportunity } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { calculateTotalCost, calculateArbitrageProfitMargin } from './fees';
import { findMatchingMarkets, parseMarket, explainMatch } from './market-matching';
import { calculateMixedMarketArbitrage } from './arbitrage-sportsbook';

interface ArbitragePair {
  market1: Market;
  market2: Market;
  market1Side: 'yes' | 'no';
  market2Side: 'yes' | 'no';
  totalCost: number;
  guaranteedReturn: number;
  profitMargin: number;
}

export interface ArbitrageScanResult {
  opportunities: ArbitrageOpportunity[];
  matchCount: number;
  profitableCount: number;
}

export interface ArbitrageScanOptions {
  label?: string;
  silent?: boolean;
}

/**
 * Finds arbitrage opportunities between two sets of markets
 * Uses sophisticated market matching to find identical markets
 * across platforms even with different wording
 */
export function findArbitrageOpportunities(
  markets1: Market[],
  markets2: Market[],
  minProfitMargin: number
): ArbitrageOpportunity[] {
  return runArbitrageScan(markets1, markets2, minProfitMargin, {
    label: 'legacy',
    silent: false,
  }).opportunities;
}

export function scanArbitrageOpportunities(
  markets1: Market[],
  markets2: Market[],
  minProfitMargin: number,
  options: ArbitrageScanOptions = {}
): ArbitrageScanResult {
  return runArbitrageScan(markets1, markets2, minProfitMargin, options);
}

function runArbitrageScan(
  markets1: Market[],
  markets2: Market[],
  minProfitMargin: number,
  options: ArbitrageScanOptions = {}
): ArbitrageScanResult {
  const opportunities: ArbitrageOpportunity[] = [];
  const labelPrefix = options.label
    ? `[ArbMatch:${options.label}]`
    : '[ArbMatch]';

  // Use sophisticated matching (70% similarity threshold)
  const matches = findMatchingMarkets(markets1, markets2, 0.7);

  if (!options.silent) {
    console.log(
      `${labelPrefix} Found ${matches.length} matching markets across platforms`
    );
  }

  let profitableCount = 0;

  // Check each matched pair for arbitrage
  for (const match of matches) {
    const { market1, market2, similarity, flipSides } = match;

    // Log high-quality matches for monitoring
    if (!options.silent && similarity > 0.85) {
      console.log(
        `${labelPrefix} High-quality match (${(similarity * 100).toFixed(
          1
        )}%):`
      );
      console.log(`  ${market1.platform}: ${market1.title}`);
      console.log(`  ${market2.platform}: ${market2.title}`);
      if (flipSides) {
        console.log(`  ⚠️  Opposing directions detected - will flip sides`);
      }
    }

    // Determine which side combinations to try based on market direction
    let combinations: ArbitragePair[];

    if (flipSides) {
      // Markets have opposing directions (e.g., "above 70" vs "below 70")
      // Only try same-side combinations (YES-YES and NO-NO)
      combinations = [
        calculateArbitrage(market1, market2, 'yes', 'yes'),
        calculateArbitrage(market1, market2, 'no', 'no'),
      ];
    } else {
      // Normal case: try opposite sides (YES-NO and NO-YES)
      combinations = [
        calculateArbitrage(market1, market2, 'yes', 'no'),
        calculateArbitrage(market1, market2, 'no', 'yes'),
      ];
    }

    for (const combo of combinations) {
      if (combo.profitMargin >= minProfitMargin) {
        profitableCount += 1;
        const profit = combo.guaranteedReturn - combo.totalCost;
        opportunities.push({
          id: uuidv4(),
          market1: combo.market1,
          market2: combo.market2,
          side1: combo.market1Side,
          side2: combo.market2Side,
          profitMargin: combo.profitMargin,
          profitPercentage: combo.profitMargin,
          betSize1: combo.totalCost / 2,
          betSize2: combo.totalCost / 2,
          expectedProfit: profit,
          netProfit: profit,
          timestamp: new Date(),
        });

        if (!options.silent) {
          console.log(
            `${labelPrefix} ✅ Arbitrage found (${combo.profitMargin.toFixed(
              2
            )}% profit):\n` +
              `  ${combo.market1.platform} ${combo.market1Side.toUpperCase()}: ${combo.market1.title}\n` +
              `  ${combo.market2.platform} ${combo.market2Side.toUpperCase()}: ${combo.market2.title}`
          );
        }
      }
    }
  }

  const sorted = opportunities.sort(
    (a, b) => b.profitMargin - a.profitMargin
  );

  if (!options.silent) {
    console.log(
      `${labelPrefix} ${sorted.length} profitable combination(s) met minProfitMargin=${minProfitMargin}%`
    );
  }

  return {
    opportunities: sorted,
    matchCount: matches.length,
    profitableCount,
  };
}
function calculateArbitrage(
  market1: Market,
  market2: Market,
  side1: 'yes' | 'no',
  side2: 'yes' | 'no'
): ArbitragePair {
  // Check if we have mixed market types (prediction vs sportsbook)
  const hasSportsbook = market1.marketType === 'sportsbook' || market2.marketType === 'sportsbook';
  const hasPrediction = market1.marketType === 'prediction' || market2.marketType === 'prediction';
  
  if (hasSportsbook && hasPrediction) {
    // Mixed markets: use special calculation
    const result = calculateMixedMarketArbitrage(market1, market2, side1, side2);
    return {
      market1,
      market2,
      market1Side: side1,
      market2Side: side2,
      totalCost: result.totalCost,
      guaranteedReturn: result.guaranteedReturn,
      profitMargin: result.profitMargin,
    };
  } else if (market1.marketType === 'sportsbook' && market2.marketType === 'sportsbook') {
    // Both sportsbooks: use decimal odds logic
    const result = calculateMixedMarketArbitrage(market1, market2, side1, side2);
    return {
      market1,
      market2,
      market1Side: side1,
      market2Side: side2,
      totalCost: result.totalCost,
      guaranteedReturn: result.guaranteedReturn,
      profitMargin: result.profitMargin,
    };
  } else {
    // Both prediction markets: use original logic
    const price1 = side1 === 'yes' ? market1.yesPrice : market1.noPrice;
    const price2 = side2 === 'yes' ? market2.yesPrice : market2.noPrice;

    // Calculate actual costs including precise fees for 1 contract
    const cost1Result = calculateTotalCost(
      market1.platform,
      market1.ticker,
      price1,
      1,
      false
    );
    
    const cost2Result = calculateTotalCost(
      market2.platform,
      market2.ticker,
      price2,
      1,
      false
    );

    const totalCost = cost1Result.totalCost + cost2Result.totalCost;
    const guaranteedReturn = 1; // One side always pays $1

    const profitMargin = calculateArbitrageProfitMargin(
      cost1Result.totalCost,
      cost2Result.totalCost
    );

    return {
      market1,
      market2,
      market1Side: side1,
      market2Side: side2,
      totalCost,
      guaranteedReturn,
      profitMargin,
    };
  }
}

/**
 * Basic title normalization (legacy - now using sophisticated matching)
 * Kept for backwards compatibility
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Note: Main matching now uses market-matching.ts with entity extraction,
// date parsing, and semantic similarity scoring

/**
 * Calculate optimal bet sizes based on account balances
 * Ensures we don't exceed the max bet percentage on either side
 */
export function calculateBetSizes(
  opportunity: ArbitrageOpportunity,
  balance1: number,
  balance2: number,
  maxBetPercentage: number
): { amount1: number; amount2: number; quantity1: number; quantity2: number } {
  const maxBet1 = balance1 * (maxBetPercentage / 100);
  const maxBet2 = balance2 * (maxBetPercentage / 100);

  // Get prices
  const price1 =
    opportunity.side1 === 'yes' ? opportunity.market1.yesPrice : opportunity.market1.noPrice;
  const price2 =
    opportunity.side2 === 'yes' ? opportunity.market2.yesPrice : opportunity.market2.noPrice;

  // Calculate actual cost per share including precise fees
  const cost1PerShare = calculateTotalCost(
    opportunity.market1.platform,
    opportunity.market1.ticker,
    price1,
    1,
    false
  ).totalCost;
  
  const cost2PerShare = calculateTotalCost(
    opportunity.market2.platform,
    opportunity.market2.ticker,
    price2,
    1,
    false
  ).totalCost;

  // We need to bet proportionally to ensure both sides cover each other
  const ratio1 = cost1PerShare;
  const ratio2 = cost2PerShare;
  const totalRatio = ratio1 + ratio2;

  // Calculate how much we can bet total given our balance constraints
  const maxTotalBet1 = maxBet1 / (ratio1 / totalRatio);
  const maxTotalBet2 = maxBet2 / (ratio2 / totalRatio);
  const maxTotalBet = Math.min(maxTotalBet1, maxTotalBet2);

  // Allocate proportionally
  const amount1 = maxTotalBet * (ratio1 / totalRatio);
  const amount2 = maxTotalBet * (ratio2 / totalRatio);

  // Calculate quantities (number of contracts)
  const quantity1 = Math.floor(amount1 / cost1PerShare);
  const quantity2 = Math.floor(amount2 / cost2PerShare);

  // Recalculate actual amounts based on whole contracts
  // This ensures we account for fees on the actual quantity
  const actualCost1 = calculateTotalCost(
    opportunity.market1.platform,
    opportunity.market1.ticker,
    price1,
    quantity1,
    false
  ).totalCost;
  
  const actualCost2 = calculateTotalCost(
    opportunity.market2.platform,
    opportunity.market2.ticker,
    price2,
    quantity2,
    false
  ).totalCost;

  return {
    amount1: actualCost1,
    amount2: actualCost2,
    quantity1,
    quantity2,
  };
}

/**
 * Validate that an arbitrage opportunity is still valid
 * Check that prices haven't moved and opportunity still exists
 */
export function validateOpportunity(
  opportunity: ArbitrageOpportunity,
  minProfitMargin: number
): boolean {
  const price1 =
    opportunity.side1 === 'yes' ? opportunity.market1.yesPrice : opportunity.market1.noPrice;
  const price2 =
    opportunity.side2 === 'yes' ? opportunity.market2.yesPrice : opportunity.market2.noPrice;

  // Use precise fee calculations
  const cost1Result = calculateTotalCost(
    opportunity.market1.platform,
    opportunity.market1.ticker,
    price1,
    1,
    false
  );
  
  const cost2Result = calculateTotalCost(
    opportunity.market2.platform,
    opportunity.market2.ticker,
    price2,
    1,
    false
  );

  const totalCost = cost1Result.totalCost + cost2Result.totalCost;
  const profitMargin = calculateArbitrageProfitMargin(
    cost1Result.totalCost,
    cost2Result.totalCost
  );

  return profitMargin >= minProfitMargin && totalCost < 1;
}

