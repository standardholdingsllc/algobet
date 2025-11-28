/**
 * Execution Wrapper
 *
 * Provides a unified execution path for arbitrage opportunities that:
 * - Routes to dry-fire (paper trading) mode when DRY_FIRE_MODE=true
 * - Routes to real execution otherwise
 * - Ensures all orders go through a single, auditable path
 *
 * IMPORTANT: This is the ONLY path for executing opportunities.
 * All callers must use executeOpportunityWithMode() to ensure
 * dry-fire mode is respected.
 */

import { ArbitrageOpportunity, Bet, ArbitrageGroup, MarketPlatform } from '@/types';
import {
  DryFireTradeLog,
  DryFireTradeStatus,
  SafetySnapshot,
  isDryFireMode,
} from '@/types/dry-fire';
import {
  createDryFireLog,
  logDryFireTrade,
} from './dry-fire-logger';
import { calculateBetSizes, validateOpportunity } from './arbitrage';
import { KVStorage } from './kv-storage';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for opportunity execution
 */
export interface ExecutionOptions {
  /** Available balance on Kalshi */
  kalshiBalance: number;
  /** Available balance on Polymarket */
  polymarketBalance: number;
  /** Available balance on SX.bet */
  sxbetBalance: number;
  /** Maximum bet percentage per platform */
  maxBetPercentage: number;
  /** Minimum profit margin to execute */
  minProfitMargin: number;
  /** Maximum days to expiry */
  maxDaysToExpiry: number;
  /** Safety snapshot (for live arb) */
  safetySnapshot?: SafetySnapshot;
  /** Scan type that found this opportunity */
  scanType?: 'tracked' | 'general' | 'live';
}

/**
 * Result of opportunity execution
 */
export interface ExecutionResult {
  /** Whether execution was attempted (true even for dry-fire) */
  attempted: boolean;
  /** Whether execution succeeded (or would succeed in dry-fire) */
  success: boolean;
  /** Mode of execution */
  mode: 'LIVE' | 'DRY_FIRE';
  /** Reason if not attempted or failed */
  reason?: string;
  /** Bet records if successful */
  bets?: Bet[];
  /** Arbitrage group if successful */
  group?: ArbitrageGroup;
  /** Dry-fire log if in dry-fire mode */
  dryFireLog?: DryFireTradeLog;
}

/**
 * Platform bet execution function type
 */
export type PlatformBetFn = (
  marketId: string,
  ticker: string,
  side: 'yes' | 'no',
  price: number,
  quantity: number
) => Promise<{ success: boolean; orderId?: string; error?: string }>;

/**
 * Platform adapters for execution
 */
export interface PlatformAdapters {
  kalshi: {
    placeBet: PlatformBetFn;
    cancelOrder: (orderId: string) => Promise<void>;
  };
  polymarket: {
    placeBet: PlatformBetFn;
    cancelOrder: (orderId: string) => Promise<void>;
  };
  sxbet: {
    placeBet: PlatformBetFn;
    cancelOrder: (orderId: string) => Promise<void>;
  };
}

// ============================================================================
// Dry-Fire Guard
// ============================================================================

/**
 * Check if dry-fire mode is active.
 * This is the authoritative check used by all execution paths.
 */
export function checkDryFireMode(): boolean {
  return isDryFireMode();
}

/**
 * Guard function that throws if attempting real execution in dry-fire mode.
 * Used as a belt-and-suspenders safety check in platform adapters.
 */
export function assertNotDryFire(operation: string): void {
  if (isDryFireMode()) {
    const error = `[DRY-FIRE GUARD] Attempted ${operation} in DRY_FIRE_MODE - this should never happen!`;
    console.error(error);
    throw new Error(error);
  }
}

// ============================================================================
// Main Execution Entry Point
// ============================================================================

/**
 * Execute an arbitrage opportunity with mode detection.
 *
 * This is the ONLY function that should be called to execute opportunities.
 * It automatically routes to dry-fire or real execution based on config.
 *
 * @param opportunity The arbitrage opportunity to execute
 * @param options Execution options including balances and limits
 * @param adapters Platform adapters for real execution
 * @returns Execution result
 */
export async function executeOpportunityWithMode(
  opportunity: ArbitrageOpportunity,
  options: ExecutionOptions,
  adapters: PlatformAdapters
): Promise<ExecutionResult> {
  // Check mode
  const dryFireActive = checkDryFireMode();

  console.log(
    `[Execution] Processing opportunity: ${opportunity.market1.title} ` +
    `(${opportunity.market1.platform} vs ${opportunity.market2.platform}) ` +
    `Mode: ${dryFireActive ? 'DRY_FIRE' : 'LIVE'}`
  );

  // Run all validations first (same for both modes)
  const validationResult = validateOpportunityForExecution(opportunity, options);

  if (!validationResult.valid) {
    // Log rejected opportunity in dry-fire mode
    if (dryFireActive) {
      const dryFireLog = createDryFireLog(opportunity, validationResult.status, {
        rejectReasons: [validationResult.reason!],
        safetySnapshot: options.safetySnapshot,
        scanType: options.scanType,
      });
      await logDryFireTrade(dryFireLog);

      return {
        attempted: false,
        success: false,
        mode: 'DRY_FIRE',
        reason: validationResult.reason,
        dryFireLog,
      };
    }

    return {
      attempted: false,
      success: false,
      mode: 'LIVE',
      reason: validationResult.reason,
    };
  }

  // Calculate bet sizes
  const { amount1, amount2, quantity1, quantity2 } = calculateBetSizesForOpportunity(
    opportunity,
    options
  );

  // Check minimum bet sizes
  if (quantity1 < 1 || quantity2 < 1) {
    const reason = 'Bet size too small';

    if (dryFireActive) {
      const dryFireLog = createDryFireLog(opportunity, 'REJECTED_BY_RISK', {
        rejectReasons: [reason],
        safetySnapshot: options.safetySnapshot,
        betSizes: { amount1, amount2, quantity1, quantity2 },
        scanType: options.scanType,
      });
      await logDryFireTrade(dryFireLog);

      return {
        attempted: false,
        success: false,
        mode: 'DRY_FIRE',
        reason,
        dryFireLog,
      };
    }

    return {
      attempted: false,
      success: false,
      mode: 'LIVE',
      reason,
    };
  }

  // Route to appropriate execution path
  if (dryFireActive) {
    return executeOpportunityDryFire(opportunity, options, {
      amount1,
      amount2,
      quantity1,
      quantity2,
    });
  } else {
    return executeOpportunityReal(opportunity, options, adapters, {
      amount1,
      amount2,
      quantity1,
      quantity2,
    });
  }
}

// ============================================================================
// Validation
// ============================================================================

interface ValidationResult {
  valid: boolean;
  reason?: string;
  status: DryFireTradeStatus;
}

function validateOpportunityForExecution(
  opportunity: ArbitrageOpportunity,
  options: ExecutionOptions
): ValidationResult {
  // Check profit margin
  if (!validateOpportunity(opportunity, options.minProfitMargin)) {
    return {
      valid: false,
      reason: 'Opportunity no longer valid (profit margin)',
      status: 'REJECTED_BY_VALIDATION',
    };
  }

  // Check expiry window
  const now = new Date();
  const maxExpiryDate = new Date(now.getTime() + options.maxDaysToExpiry * 24 * 60 * 60 * 1000);

  const market1Expiry = new Date(opportunity.market1.expiryDate);
  const market2Expiry = new Date(opportunity.market2.expiryDate);

  const withinWindow = market1Expiry <= maxExpiryDate && market2Expiry <= maxExpiryDate;

  if (!withinWindow) {
    const daysToExpiry1 = (market1Expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    const daysToExpiry2 = (market2Expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    const maxDays = Math.max(daysToExpiry1, daysToExpiry2);

    return {
      valid: false,
      reason: `Outside execution window (${maxDays.toFixed(1)} days)`,
      status: 'REJECTED_BY_RISK',
    };
  }

  return { valid: true, status: 'SIMULATED' };
}

function calculateBetSizesForOpportunity(
  opportunity: ArbitrageOpportunity,
  options: ExecutionOptions
): { amount1: number; amount2: number; quantity1: number; quantity2: number } {
  const getBalance = (platform: MarketPlatform) => {
    switch (platform) {
      case 'kalshi': return options.kalshiBalance;
      case 'polymarket': return options.polymarketBalance;
      case 'sxbet': return options.sxbetBalance;
    }
  };

  const platform1Balance = getBalance(opportunity.market1.platform);
  const platform2Balance = getBalance(opportunity.market2.platform);

  return calculateBetSizes(
    opportunity,
    platform1Balance,
    platform2Balance,
    options.maxBetPercentage
  );
}

// ============================================================================
// Dry-Fire Execution
// ============================================================================

async function executeOpportunityDryFire(
  opportunity: ArbitrageOpportunity,
  options: ExecutionOptions,
  betSizes: { amount1: number; amount2: number; quantity1: number; quantity2: number }
): Promise<ExecutionResult> {
  console.log(
    `📝 DRY-FIRE: Would execute ${opportunity.market1.title}`
  );
  console.log(`   Platforms: ${opportunity.market1.platform} vs ${opportunity.market2.platform}`);
  console.log(`   Profit: $${opportunity.expectedProfit.toFixed(2)} (${opportunity.profitMargin.toFixed(2)}%)`);
  console.log(`   Investment: $${(betSizes.amount1 + betSizes.amount2).toFixed(2)}`);

  // Create and log dry-fire trade
  const dryFireLog = createDryFireLog(opportunity, 'SIMULATED', {
    safetySnapshot: options.safetySnapshot,
    betSizes,
    scanType: options.scanType,
  });

  await logDryFireTrade(dryFireLog);

  return {
    attempted: true,
    success: true,
    mode: 'DRY_FIRE',
    dryFireLog,
  };
}

// ============================================================================
// Real Execution
// ============================================================================

async function executeOpportunityReal(
  opportunity: ArbitrageOpportunity,
  options: ExecutionOptions,
  adapters: PlatformAdapters,
  betSizes: { amount1: number; amount2: number; quantity1: number; quantity2: number }
): Promise<ExecutionResult> {
  // Final safety check
  assertNotDryFire('executeOpportunityReal');

  console.log(
    `🚀 LIVE: Executing arbitrage: ${opportunity.market1.title}`
  );
  console.log(`   Amounts: $${betSizes.amount1.toFixed(2)} and $${betSizes.amount2.toFixed(2)}`);
  console.log(`   Expected profit: $${opportunity.expectedProfit.toFixed(2)} (${opportunity.profitMargin.toFixed(2)}%)`);

  const price1 = opportunity.side1 === 'yes' ? opportunity.market1.yesPrice : opportunity.market1.noPrice;
  const price2 = opportunity.side2 === 'yes' ? opportunity.market2.yesPrice : opportunity.market2.noPrice;

  // Get appropriate adapters
  const adapter1 = adapters[opportunity.market1.platform];
  const adapter2 = adapters[opportunity.market2.platform];

  // Place both bets simultaneously
  const [result1, result2] = await Promise.all([
    adapter1.placeBet(
      opportunity.market1.id,
      opportunity.market1.ticker,
      opportunity.side1,
      price1,
      betSizes.quantity1
    ),
    adapter2.placeBet(
      opportunity.market2.id,
      opportunity.market2.ticker,
      opportunity.side2,
      price2,
      betSizes.quantity2
    ),
  ]);

  // Check results
  if (result1.success && result2.success) {
    console.log('✅ Both bets placed successfully');

    // Create bet records
    const bet1: Bet = {
      id: result1.orderId!,
      placedAt: new Date(),
      platform: opportunity.market1.platform,
      marketId: opportunity.market1.id,
      ticker: opportunity.market1.ticker,
      marketTitle: opportunity.market1.title,
      side: opportunity.side1,
      price: price1,
      amount: betSizes.amount1,
      status: 'filled',
      arbitrageGroupId: opportunity.id,
    };

    const bet2: Bet = {
      id: result2.orderId!,
      placedAt: new Date(),
      platform: opportunity.market2.platform,
      marketId: opportunity.market2.id,
      ticker: opportunity.market2.ticker,
      marketTitle: opportunity.market2.title,
      side: opportunity.side2,
      price: price2,
      amount: betSizes.amount2,
      status: 'filled',
      arbitrageGroupId: opportunity.id,
    };

    // Persist
    await Promise.all([KVStorage.addBet(bet1), KVStorage.addBet(bet2)]);

    const group: ArbitrageGroup = {
      id: opportunity.id,
      createdAt: new Date(),
      bet1,
      bet2,
      expectedProfit: opportunity.expectedProfit,
      status: 'active',
    };

    await KVStorage.addArbitrageGroup(group);

    return {
      attempted: true,
      success: true,
      mode: 'LIVE',
      bets: [bet1, bet2],
      group,
    };
  } else {
    console.error('❌ One or both bets failed');

    // Cancel any successful bet
    if (result1.success && result1.orderId) {
      try {
        await adapter1.cancelOrder(result1.orderId);
      } catch (e) {
        console.error('Failed to cancel bet 1:', e);
      }
    }
    if (result2.success && result2.orderId) {
      try {
        await adapter2.cancelOrder(result2.orderId);
      } catch (e) {
        console.error('Failed to cancel bet 2:', e);
      }
    }

    return {
      attempted: true,
      success: false,
      mode: 'LIVE',
      reason: `Bet 1: ${result1.error || 'OK'}, Bet 2: ${result2.error || 'OK'}`,
    };
  }
}

// ============================================================================
// Utility: Create opportunity log for KV storage
// ============================================================================

export function createOpportunityLog(
  opportunity: ArbitrageOpportunity,
  betSizes: { amount1: number; amount2: number },
  options: { maxDaysToExpiry: number }
) {
  const now = new Date();
  const market1Expiry = new Date(opportunity.market1.expiryDate);
  const market2Expiry = new Date(opportunity.market2.expiryDate);
  const maxExpiryDate = new Date(now.getTime() + options.maxDaysToExpiry * 24 * 60 * 60 * 1000);

  const daysToExpiry1 = (market1Expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  const daysToExpiry2 = (market2Expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  const maxDays = Math.max(daysToExpiry1, daysToExpiry2);
  const withinWindow = market1Expiry <= maxExpiryDate && market2Expiry <= maxExpiryDate;

  return {
    id: uuidv4(),
    timestamp: now,
    eventName: opportunity.market1.title,
    platform1: opportunity.market1.platform,
    platform2: opportunity.market2.platform,
    market1Id: opportunity.market1.id,
    market2Id: opportunity.market2.id,
    market1Side: opportunity.side1,
    market2Side: opportunity.side2,
    market1Price: opportunity.side1 === 'yes' ? opportunity.market1.yesPrice : opportunity.market1.noPrice,
    market2Price: opportunity.side2 === 'yes' ? opportunity.market2.yesPrice : opportunity.market2.noPrice,
    market1Type: opportunity.market1.marketType,
    market2Type: opportunity.market2.marketType,
    profitMargin: opportunity.profitMargin,
    estimatedProfit: opportunity.expectedProfit,
    betSize1: betSizes.amount1,
    betSize2: betSizes.amount2,
    totalInvestment: betSizes.amount1 + betSizes.amount2,
    expiryDate: opportunity.market1.expiryDate,
    daysToExpiry: maxDays,
    withinExecutionWindow: withinWindow,
    skipReason: !withinWindow ? `Outside execution window (${maxDays.toFixed(1)} days)` : undefined,
  };
}

