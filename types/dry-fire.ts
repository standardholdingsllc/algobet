/**
 * Dry-Fire (Paper Trading) Types
 *
 * These types define the structure for logging simulated trades
 * when the KV-backed execution mode is set to DRY_FIRE. The system runs
 * all pricing, risk checks, and calculations but never sends real orders.
 */

import { MarketPlatform } from './index';

// ============================================================================
// Dry-Fire Trade Status
// ============================================================================

/**
 * Status of a dry-fire trade log entry
 */
export type DryFireTradeStatus =
  | 'SIMULATED'           // Would have been executed
  | 'REJECTED_BY_SAFETY'  // Failed safety checks (price age, slippage, etc.)
  | 'REJECTED_BY_RISK'    // Failed risk checks (expiry, bet size, etc.)
  | 'REJECTED_BY_VALIDATION'; // Failed opportunity validation

// ============================================================================
// Dry-Fire Trade Leg
// ============================================================================

/**
 * Individual leg of a dry-fire trade (one per platform)
 */
export interface DryFireTradeLeg {
  /** Platform for this leg */
  platform: MarketPlatform;

  /** Market ID / condition ID / ticker */
  marketId: string;

  /** Market ticker (for display) */
  ticker: string;

  /** Market title */
  title: string;

  /** Side of the bet */
  side: 'yes' | 'no';

  /** Intended stake in USD */
  intendedStake: number;

  /** Intended price (cents for prediction, decimal odds for sportsbook) */
  intendedPrice: number;

  /** Implied probability (0-1) */
  impliedProbability: number;

  /** Number of contracts */
  quantity: number;

  /** Estimated fee in USD */
  estimatedFee: number;

  /** Market type */
  marketType: 'prediction' | 'sportsbook';

  /** Expiry date ISO string */
  expiryDate: string;
}

// ============================================================================
// Safety Snapshot
// ============================================================================

/**
 * Snapshot of safety metrics at decision time
 */
export interface SafetySnapshot {
  /** Maximum price age across legs (ms) */
  maxPriceAgeMs?: number;

  /** Estimated slippage (bps) */
  estimatedSlippageBps?: number;

  /** Combined implied probability */
  combinedImpliedProb?: number;

  /** Platform skew percentage */
  platformSkewPct?: number;

  /** Whether circuit breaker was open */
  circuitBreakerOpen?: boolean;

  /** Data source for prices */
  priceSource?: 'websocket' | 'rest' | 'snapshot';

  /** Whether this was a live event */
  isLiveEvent?: boolean;
}

// ============================================================================
// Dry-Fire Trade Log
// ============================================================================

/**
 * Complete dry-fire trade log entry
 */
export interface DryFireTradeLog {
  /** Unique identifier */
  id: string;

  /** When this log was created */
  createdAt: string;

  /** Always 'DRY_FIRE' for this mode */
  mode: 'DRY_FIRE';

  /** Reference to the opportunity ID */
  opportunityId: string;

  /** Hash of the opportunity for deduplication */
  opportunityHash: string;

  /** Trade legs (one per platform) */
  legs: DryFireTradeLeg[];

  /** Expected profit in USD */
  expectedProfitUsd: number;

  /** Expected profit in basis points */
  expectedProfitBps: number;

  /** Expected profit percentage */
  expectedProfitPct: number;

  /** Total intended investment across all legs */
  totalInvestment: number;

  /** Status of this trade */
  status: DryFireTradeStatus;

  /** Reasons for rejection (if status is REJECTED_*) */
  rejectReasons?: string[];

  /** Whether this involved a live event */
  isLiveEvent: boolean;

  /** Days until earliest expiry */
  daysToExpiry: number;

  /** Safety metrics at decision time */
  safetySnapshot?: SafetySnapshot;

  /** Additional metadata */
  meta?: {
    /** Scan type that found this opportunity */
    scanType?: 'tracked' | 'general' | 'live';
    /** Match similarity score */
    matchSimilarity?: number;
  };
}

// ============================================================================
// Dry-Fire Statistics
// ============================================================================

/**
 * Aggregated dry-fire statistics
 */
export interface DryFireStats {
  /** Whether dry-fire mode is enabled */
  dryFireModeEnabled: boolean;

  /** Total simulated trades */
  totalSimulated: number;

  /** Total rejected by safety */
  totalRejectedBySafety: number;

  /** Total rejected by risk */
  totalRejectedByRisk: number;

  /** Total rejected by validation */
  totalRejectedByValidation: number;

  /** Breakdown by platform */
  byPlatform: {
    [K in MarketPlatform]: {
      simulated: number;
      rejected: number;
    };
  };

  /** Profit histogram (count per bps bucket) */
  profitBuckets: {
    '0-25bps': number;
    '25-50bps': number;
    '50-100bps': number;
    '100-200bps': number;
    '200+bps': number;
  };

  /** Total potential profit if all simulated trades executed */
  totalPotentialProfitUsd: number;

  /** Average profit per simulated trade */
  avgProfitPerTradeUsd: number;

  /** Timestamp of stats generation */
  generatedAt: string;

  /** Time range of data */
  since?: string;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Dry-fire mode configuration
 */
export interface DryFireConfig {
  /** Master switch for dry-fire mode */
  enabled: boolean;

  /** Log all eligible opportunities, not just those that pass checks */
  logAllOpportunities: boolean;

  /** Log rejection reasons in detail */
  logRejectedReasons: boolean;

  /** Maximum logs to keep in memory/DB */
  maxLogsToKeep: number;
}

/**
 * Default dry-fire configuration
 */
export const DEFAULT_DRY_FIRE_CONFIG: DryFireConfig = {
  enabled: false,
  logAllOpportunities: true,
  logRejectedReasons: true,
  maxLogsToKeep: 1000,
};

/**
 * Build a dry-fire config object. The caller can optionally provide overrides
 * (e.g., from KV) but by default we fall back to safe, verbose logging.
 */
export function buildDryFireConfig(
  overrides: Partial<DryFireConfig> = {}
): DryFireConfig {
  return {
    ...DEFAULT_DRY_FIRE_CONFIG,
    ...overrides,
  };
}

