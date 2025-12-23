/**
 * Arbitrage calculations for mixed market types
 * Handles prediction markets (binary $1 payouts) vs sportsbooks (decimal odds)
 */

import { Market } from '@/types';
import { calculateTotalCost } from './fees';

/**
 * Calculate arbitrage between prediction market and sportsbook
 * 
 * Prediction market: Buy shares at price P (0-1), pays $1 per share
 * Sportsbook: Stake amount S at decimal odds O, pays S × O
 * 
 * For proper arbitrage:
 * 1. Determine target payout amount
 * 2. Size bets so both outcomes pay the same amount
 * 3. Check if total cost < guaranteed payout
 */
export function calculateMixedMarketArbitrage(
  market1: Market,
  market2: Market,
  side1: 'yes' | 'no',
  side2: 'yes' | 'no'
): {
  totalCost: number;
  guaranteedReturn: number;
  profitMargin: number;
  amount1: number; // Amount to bet on market 1
  amount2: number; // Amount to bet on market 2
} {
  const isPrediction1 = market1.marketType === 'prediction';
  const isPrediction2 = market2.marketType === 'prediction';

  // Get prices/odds
  const value1 = side1 === 'yes' ? market1.yesPrice : market1.noPrice;
  const value2 = side2 === 'yes' ? market2.yesPrice : market2.noPrice;

  let amount1: number;
  let amount2: number;
  let payout1: number;
  let payout2: number;

  // Case 1: Both prediction markets (original logic)
  if (isPrediction1 && isPrediction2) {
    // Standard prediction market arbitrage
    // Buy 100 shares on each side, each pays $100
    const shares = 100;
    amount1 = (value1 / 100) * shares; // price in cents → dollars
    amount2 = (value2 / 100) * shares;
    payout1 = shares; // $100
    payout2 = shares; // $100
  }
  // Case 2: Market 1 is prediction, Market 2 is sportsbook
  else if (isPrediction1 && !isPrediction2) {
    // Prediction market: buy shares at value1 cents, pays $1 per share
    // Sportsbook: stake at value2 decimal odds, pays stake × odds
    
    // Set target payout (let's use $100 as standard)
    const targetPayout = 100;
    
    // Prediction market: need targetPayout shares
    const shares1 = targetPayout;
    amount1 = (value1 / 100) * shares1; // price in cents → dollars
    payout1 = targetPayout;
    
    // Sportsbook: stake to get targetPayout
    // payout = stake × odds, so stake = payout / odds
    amount2 = targetPayout / value2;
    payout2 = targetPayout;
  }
  // Case 3: Market 1 is sportsbook, Market 2 is prediction
  else if (!isPrediction1 && isPrediction2) {
    // Sportsbook: stake at value1 decimal odds
    // Prediction market: buy shares at value2 cents
    
    const targetPayout = 100;
    
    // Sportsbook: stake to get targetPayout
    amount1 = targetPayout / value1;
    payout1 = targetPayout;
    
    // Prediction market: need targetPayout shares
    const shares2 = targetPayout;
    amount2 = (value2 / 100) * shares2;
    payout2 = targetPayout;
  }
  // Case 4: Both sportsbooks
  else {
    // Two sportsbooks with decimal odds
    const targetPayout = 100;
    
    // Stake to achieve target payout on each side
    amount1 = targetPayout / value1;
    payout1 = targetPayout;
    
    amount2 = targetPayout / value2;
    payout2 = targetPayout;
  }

  // Calculate costs including fees
  const cost1 = calculateCostWithFees(market1, amount1, 1);
  const cost2 = calculateCostWithFees(market2, amount2, 1);
  
  const totalCost = cost1 + cost2;
  const guaranteedReturn = payout1; // Both payouts should be equal
  
  const profitMargin = guaranteedReturn > totalCost 
    ? ((guaranteedReturn - totalCost) / totalCost) * 100 
    : 0;

  return {
    totalCost,
    guaranteedReturn,
    profitMargin,
    amount1: cost1, // Return actual cost including fees
    amount2: cost2,
  };
}

/**
 * Calculate cost including fees for a market
 * Handles both prediction markets and sportsbooks
 */
function calculateCostWithFees(
  market: Market,
  amount: number,
  quantity: number
): number {
  if (market.marketType === 'prediction') {
    // For prediction markets, use existing fee calculation
    // amount is already in dollars, but we need to convert to price in cents
    const priceInCents = (amount / quantity) * 100;
    const result = calculateTotalCost(
      market.platform,
      market.ticker,
      priceInCents,
      quantity,
      false
    );
    return result.totalCost;
  } else {
    // For sportsbooks (sx.bet has 0% fees)
    // amount is the stake, no additional calculations needed
    return amount; // No fees on sx.bet
  }
}

/**
 * Calculate optimal bet sizes for mixed markets
 * Ensures proper hedging across different market types
 */
export function calculateMixedMarketBetSizes(
  market1: Market,
  market2: Market,
  side1: 'yes' | 'no',
  side2: 'yes' | 'no',
  balance1: number,
  balance2: number,
  maxBetPercentage: number
): {
  amount1: number;
  amount2: number;
  quantity1: number;
  quantity2: number;
  estimatedProfit: number;
} {
  const maxBet1 = balance1 * (maxBetPercentage / 100);
  const maxBet2 = balance2 * (maxBetPercentage / 100);

  // Get base arbitrage calculation
  const baseArb = calculateMixedMarketArbitrage(market1, market2, side1, side2);
  
  // Calculate scale factor based on balance constraints
  const scaleFactor = Math.min(
    maxBet1 / baseArb.amount1,
    maxBet2 / baseArb.amount2,
    1 // Don't scale up, only down
  );

  // Scale the bets
  const amount1 = baseArb.amount1 * scaleFactor;
  const amount2 = baseArb.amount2 * scaleFactor;
  const guaranteedReturn = baseArb.guaranteedReturn * scaleFactor;
  const totalCost = baseArb.totalCost * scaleFactor;
  
  // Calculate quantities based on market type
  let quantity1: number;
  let quantity2: number;

  if (market1.marketType === 'prediction') {
    // Prediction market: quantity = shares to buy
    const pricePerShare = (side1 === 'yes' ? market1.yesPrice : market1.noPrice) / 100;
    quantity1 = Math.floor(amount1 / pricePerShare);
  } else {
    // Sportsbook: quantity = 1 (it's a single bet with a stake)
    quantity1 = 1;
  }

  if (market2.marketType === 'prediction') {
    const pricePerShare = (side2 === 'yes' ? market2.yesPrice : market2.noPrice) / 100;
    quantity2 = Math.floor(amount2 / pricePerShare);
  } else {
    quantity2 = 1;
  }

  return {
    amount1,
    amount2,
    quantity1,
    quantity2,
    estimatedProfit: guaranteedReturn - totalCost,
  };
}

/**
 * Validate mixed market arbitrage opportunity
 */
export function validateMixedMarketOpportunity(
  market1: Market,
  market2: Market,
  side1: 'yes' | 'no',
  side2: 'yes' | 'no',
  minProfitMargin: number
): boolean {
  const arb = calculateMixedMarketArbitrage(market1, market2, side1, side2);
  return arb.profitMargin >= minProfitMargin && arb.guaranteedReturn > arb.totalCost;
}

