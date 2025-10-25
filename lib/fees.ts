/**
 * Fee calculations for prediction markets
 * 
 * Each platform has different fee structures that must be
 * accurately calculated to ensure profitable arbitrage
 */

/**
 * Calculate Kalshi trading fee
 * Source: https://kalshi.com/docs/kalshi-fee-schedule.pdf
 * 
 * Formula: fees = round_up(multiplier × C × P × (1-P))
 * - General markets: multiplier = 0.07 (7%)
 * - S&P500/NASDAQ-100: multiplier = 0.035 (3.5%)
 * - Maker fees: multiplier = 0.0175 (1.75%)
 * 
 * @param ticker Market ticker (e.g., "INXD-24DEC31", "NASDAQ100W-24")
 * @param price Price in cents (0-100)
 * @param quantity Number of contracts
 * @param isMaker Whether this is a maker order (resting on orderbook)
 * @returns Fee in dollars
 */
export function calculateKalshiFee(
  ticker: string,
  price: number,
  quantity: number,
  isMaker: boolean = false
): number {
  const P = price / 100; // Convert cents to dollars (0-1)
  const C = quantity;
  
  let feeMultiplier: number;
  
  if (isMaker) {
    // Maker fees for resting orders
    feeMultiplier = 0.0175;
  } else if (ticker.startsWith('INX') || ticker.startsWith('NASDAQ100')) {
    // S&P500 and NASDAQ-100 markets have reduced fees
    feeMultiplier = 0.035;
  } else {
    // General markets
    feeMultiplier = 0.07;
  }
  
  // Formula from fee schedule
  const feeAmount = feeMultiplier * C * P * (1 - P);
  
  // Round up to next cent (as per Kalshi rules)
  return Math.ceil(feeAmount * 100) / 100;
}

/**
 * Calculate the fee percentage for Kalshi
 * Useful for displaying in UI and for initial estimates
 * 
 * @param ticker Market ticker
 * @param price Price in cents (0-100)
 * @returns Fee as percentage of amount invested
 */
export function getKalshiFeePercentage(ticker: string, price: number): number {
  const P = price / 100;
  
  let feeMultiplier: number;
  if (ticker.startsWith('INX') || ticker.startsWith('NASDAQ100')) {
    feeMultiplier = 0.035;
  } else {
    feeMultiplier = 0.07;
  }
  
  // The fee formula is: multiplier × P × (1-P)
  // As a percentage of the amount paid (P): [multiplier × P × (1-P)] / P × 100
  // Simplifies to: multiplier × (1-P) × 100
  const feePercentage = feeMultiplier * (1 - P) * 100;
  
  return feePercentage;
}

/**
 * Calculate Polymarket trading fee
 * 
 * Polymarket uses a tiered fee structure:
 * - Taker fees: ~2% (varies by market maker)
 * - Maker fees: 0% (no fee for providing liquidity)
 * 
 * Note: Polymarket also uses USDC on Polygon, so there are
 * small gas fees (~$0.01-0.05) that should be considered
 * 
 * @param price Price in cents (0-100)
 * @param quantity Number of contracts
 * @param isMaker Whether providing liquidity
 * @returns Fee in dollars
 */
export function calculatePolymarketFee(
  price: number,
  quantity: number,
  isMaker: boolean = false
): number {
  if (isMaker) {
    // No maker fees on Polymarket
    return 0;
  }
  
  // Taker fee is approximately 2% of notional value
  const P = price / 100;
  const notionalValue = P * quantity;
  const feeAmount = notionalValue * 0.02;
  
  // Add estimated gas fee (conservative estimate)
  const gasFee = 0.02; // ~2 cents per transaction
  
  return Math.ceil((feeAmount + gasFee) * 100) / 100;
}

/**
 * Get Polymarket fee percentage for display
 * 
 * @returns Approximate fee percentage
 */
export function getPolymarketFeePercentage(): number {
  return 2.0; // 2% taker fee
}

/**
 * Calculate SX.bet trading fee
 * 
 * SX.bet currently has 0% fees for both makers and takers
 * Source: https://api.docs.sx.bet/#fees
 * 
 * @returns Fee in dollars (always 0)
 */
export function calculateSXBetFee(): number {
  return 0; // No fees on sx.bet
}

/**
 * Get SX.bet fee percentage for display
 * 
 * @returns Fee percentage (0%)
 */
export function getSXBetFeePercentage(): number {
  return 0;
}

/**
 * Calculate total cost including fees for a bet
 * 
 * @param platform 'kalshi', 'polymarket', or 'sxbet'
 * @param ticker Market ticker (for Kalshi)
 * @param price Price in cents
 * @param quantity Number of contracts
 * @param isMaker Whether this is a maker order
 * @returns Object with cost breakdown
 */
export function calculateTotalCost(
  platform: 'kalshi' | 'polymarket' | 'sxbet',
  ticker: string,
  price: number,
  quantity: number,
  isMaker: boolean = false
): {
  baseCost: number;
  fee: number;
  totalCost: number;
  effectiveFeePercentage: number;
} {
  const P = price / 100;
  const baseCost = P * quantity;
  
  let fee: number;
  let effectiveFeePercentage: number;
  
  if (platform === 'kalshi') {
    fee = calculateKalshiFee(ticker, price, quantity, isMaker);
    effectiveFeePercentage = (fee / baseCost) * 100;
  } else if (platform === 'polymarket') {
    fee = calculatePolymarketFee(price, quantity, isMaker);
    effectiveFeePercentage = (fee / baseCost) * 100;
  } else if (platform === 'sxbet') {
    fee = calculateSXBetFee();
    effectiveFeePercentage = 0;
  } else {
    fee = 0;
    effectiveFeePercentage = 0;
  }
  
  const totalCost = baseCost + fee;
  
  return {
    baseCost,
    fee,
    totalCost,
    effectiveFeePercentage,
  };
}

/**
 * Calculate profit margin for an arbitrage opportunity
 * considering all fees
 * 
 * @param side1Cost Total cost (including fees) for side 1
 * @param side2Cost Total cost (including fees) for side 2
 * @returns Profit margin as percentage
 */
export function calculateArbitrageProfitMargin(
  side1Cost: number,
  side2Cost: number
): number {
  const totalCost = side1Cost + side2Cost;
  const guaranteedReturn = 1.0; // One side always pays $1
  
  if (totalCost >= guaranteedReturn) {
    return 0; // No profit
  }
  
  const profit = guaranteedReturn - totalCost;
  const profitMargin = (profit / totalCost) * 100;
  
  return profitMargin;
}

/**
 * Validate fee calculation examples from Kalshi fee schedule
 * Used for testing to ensure our calculations match theirs
 */
export function validateKalshiFeeCalculations(): boolean {
  const testCases = [
    // General markets - from fee schedule table
    { ticker: 'TEST', price: 50, quantity: 100, expected: 1.75 },
    { ticker: 'TEST', price: 25, quantity: 100, expected: 1.32 },
    { ticker: 'TEST', price: 75, quantity: 100, expected: 1.32 },
    { ticker: 'TEST', price: 10, quantity: 100, expected: 0.63 },
    { ticker: 'TEST', price: 90, quantity: 100, expected: 0.63 },
    
    // S&P500 markets - reduced fees
    { ticker: 'INXD-24DEC31', price: 50, quantity: 100, expected: 0.88 },
    { ticker: 'INXW-24', price: 25, quantity: 100, expected: 0.66 },
    
    // NASDAQ100 markets - reduced fees
    { ticker: 'NASDAQ100D-24', price: 50, quantity: 100, expected: 0.88 },
  ];
  
  let allPassed = true;
  
  for (const test of testCases) {
    const calculated = calculateKalshiFee(test.ticker, test.price, test.quantity);
    if (Math.abs(calculated - test.expected) > 0.01) {
      console.error(
        `Fee calculation mismatch for ${test.ticker} @ ${test.price}¢: ` +
        `Expected $${test.expected}, got $${calculated}`
      );
      allPassed = false;
    }
  }
  
  return allPassed;
}

