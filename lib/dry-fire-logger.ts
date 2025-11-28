/**
 * Dry-Fire Trade Logger
 *
 * Provides persistence and retrieval for dry-fire (paper) trade logs.
 * Uses KV storage (Upstash) with in-memory fallback for development.
 *
 * Key features:
 * - Persists simulated trades to KV storage
 * - Provides aggregation for statistics
 * - Supports filtering by time range and platform
 * - CSV export capability
 */

import { v4 as uuidv4 } from 'uuid';
import {
  DryFireTradeLog,
  DryFireTradeLeg,
  DryFireTradeStatus,
  DryFireStats,
  DryFireConfig,
  SafetySnapshot,
  buildDryFireConfig,
  isDryFireMode,
} from '@/types/dry-fire';
import { ArbitrageOpportunity, MarketPlatform } from '@/types';
import { calculateTotalCost } from './fees';

// ============================================================================
// Storage Keys
// ============================================================================

const KV_DRY_FIRE_LOGS_KEY = 'dry-fire:logs';
const KV_DRY_FIRE_STATS_KEY = 'dry-fire:stats';
const MAX_LOGS_DEFAULT = 1000;

// ============================================================================
// In-Memory Fallback (for dev/testing)
// ============================================================================

let inMemoryLogs: DryFireTradeLog[] = [];
let inMemoryStats: DryFireStats | null = null;

// ============================================================================
// Configuration
// ============================================================================

let config: DryFireConfig | null = null;

/**
 * Get dry-fire configuration
 */
export function getDryFireConfig(): DryFireConfig {
  if (!config) {
    config = buildDryFireConfig();
  }
  return config;
}

/**
 * Check if dry-fire mode is active
 */
export function isDryFireModeActive(): boolean {
  return isDryFireMode();
}

// ============================================================================
// Logging Functions
// ============================================================================

/**
 * Create a DryFireTradeLog from an ArbitrageOpportunity
 */
export function createDryFireLog(
  opportunity: ArbitrageOpportunity,
  status: DryFireTradeStatus,
  options: {
    rejectReasons?: string[];
    safetySnapshot?: SafetySnapshot;
    betSizes?: { amount1: number; amount2: number; quantity1: number; quantity2: number };
    scanType?: 'tracked' | 'general' | 'live';
  } = {}
): DryFireTradeLog {
  const now = new Date();
  const { rejectReasons, safetySnapshot, betSizes, scanType } = options;

  // Calculate prices
  const price1 = opportunity.side1 === 'yes' ? opportunity.market1.yesPrice : opportunity.market1.noPrice;
  const price2 = opportunity.side2 === 'yes' ? opportunity.market2.yesPrice : opportunity.market2.noPrice;

  // Calculate fees
  const fee1Result = calculateTotalCost(
    opportunity.market1.platform,
    opportunity.market1.ticker,
    price1,
    betSizes?.quantity1 || 1,
    false
  );
  const fee2Result = calculateTotalCost(
    opportunity.market2.platform,
    opportunity.market2.ticker,
    price2,
    betSizes?.quantity2 || 1,
    false
  );

  // Build legs
  const leg1: DryFireTradeLeg = {
    platform: opportunity.market1.platform,
    marketId: opportunity.market1.id,
    ticker: opportunity.market1.ticker,
    title: opportunity.market1.title,
    side: opportunity.side1,
    intendedStake: betSizes?.amount1 || opportunity.betSize1,
    intendedPrice: price1,
    impliedProbability: opportunity.market1.marketType === 'sportsbook' 
      ? 1 / price1 
      : price1 / 100,
    quantity: betSizes?.quantity1 || 1,
    estimatedFee: fee1Result.fee,
    marketType: opportunity.market1.marketType,
    expiryDate: opportunity.market1.expiryDate,
  };

  const leg2: DryFireTradeLeg = {
    platform: opportunity.market2.platform,
    marketId: opportunity.market2.id,
    ticker: opportunity.market2.ticker,
    title: opportunity.market2.title,
    side: opportunity.side2,
    intendedStake: betSizes?.amount2 || opportunity.betSize2,
    intendedPrice: price2,
    impliedProbability: opportunity.market2.marketType === 'sportsbook' 
      ? 1 / price2 
      : price2 / 100,
    quantity: betSizes?.quantity2 || 1,
    estimatedFee: fee2Result.fee,
    marketType: opportunity.market2.marketType,
    expiryDate: opportunity.market2.expiryDate,
  };

  // Calculate days to expiry
  const expiry1 = new Date(opportunity.market1.expiryDate).getTime();
  const expiry2 = new Date(opportunity.market2.expiryDate).getTime();
  const earliestExpiry = Math.min(expiry1, expiry2);
  const daysToExpiry = (earliestExpiry - now.getTime()) / (24 * 60 * 60 * 1000);

  // Determine if live event
  const isLiveEvent = daysToExpiry < 0.125 || // Less than 3 hours
    (opportunity.market1.marketType === 'sportsbook' && daysToExpiry < 0.25); // Less than 6 hours for sports

  // Create hash for deduplication
  const opportunityHash = createOpportunityHash(opportunity);

  return {
    id: uuidv4(),
    createdAt: now.toISOString(),
    mode: 'DRY_FIRE',
    opportunityId: opportunity.id,
    opportunityHash,
    legs: [leg1, leg2],
    expectedProfitUsd: opportunity.expectedProfit,
    expectedProfitBps: opportunity.profitMargin * 100,
    expectedProfitPct: opportunity.profitMargin,
    totalInvestment: leg1.intendedStake + leg2.intendedStake,
    status,
    rejectReasons,
    isLiveEvent,
    daysToExpiry: Math.max(0, daysToExpiry),
    safetySnapshot,
    meta: {
      scanType,
    },
  };
}

/**
 * Create a hash for opportunity deduplication
 */
function createOpportunityHash(opportunity: ArbitrageOpportunity): string {
  const parts = [
    opportunity.market1.platform,
    opportunity.market1.id,
    opportunity.side1,
    opportunity.market2.platform,
    opportunity.market2.id,
    opportunity.side2,
  ].sort();
  
  // Simple hash
  let hash = 0;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Log a dry-fire trade
 */
export async function logDryFireTrade(log: DryFireTradeLog): Promise<void> {
  const cfg = getDryFireConfig();
  
  // Skip if not logging rejected trades
  if (!cfg.logAllOpportunities && log.status !== 'SIMULATED') {
    return;
  }

  try {
    // Try to use KV storage
    const { kv } = await import('@upstash/redis');
    
    // Get existing logs
    const existing = await kv.get<DryFireTradeLog[]>(KV_DRY_FIRE_LOGS_KEY) || [];
    
    // Add new log
    existing.unshift(log);
    
    // Trim to max size
    const trimmed = existing.slice(0, cfg.maxLogsToKeep);
    
    // Save back
    await kv.set(KV_DRY_FIRE_LOGS_KEY, trimmed);
    
    // Update stats cache
    await updateStatsCache(trimmed);
    
    console.log(
      `[DryFire] Logged ${log.status}: ${log.legs[0].platform} vs ${log.legs[1].platform} ` +
      `(${log.expectedProfitPct.toFixed(2)}% profit)`
    );
  } catch (error) {
    // Fallback to in-memory
    console.warn('[DryFire] KV unavailable, using in-memory storage');
    inMemoryLogs.unshift(log);
    inMemoryLogs = inMemoryLogs.slice(0, cfg.maxLogsToKeep);
    inMemoryStats = null; // Invalidate cache
    
    console.log(
      `[DryFire] Logged (in-memory) ${log.status}: ${log.legs[0].platform} vs ${log.legs[1].platform} ` +
      `(${log.expectedProfitPct.toFixed(2)}% profit)`
    );
  }
}

/**
 * Get all dry-fire trade logs
 */
export async function getDryFireLogs(options?: {
  since?: Date;
  platform?: MarketPlatform;
  status?: DryFireTradeStatus;
  limit?: number;
}): Promise<DryFireTradeLog[]> {
  let logs: DryFireTradeLog[] = [];

  try {
    const { kv } = await import('@upstash/redis');
    logs = await kv.get<DryFireTradeLog[]>(KV_DRY_FIRE_LOGS_KEY) || [];
  } catch {
    logs = inMemoryLogs;
  }

  // Apply filters
  if (options?.since) {
    const sinceMs = options.since.getTime();
    logs = logs.filter(l => new Date(l.createdAt).getTime() >= sinceMs);
  }

  if (options?.platform) {
    logs = logs.filter(l => 
      l.legs.some(leg => leg.platform === options.platform)
    );
  }

  if (options?.status) {
    logs = logs.filter(l => l.status === options.status);
  }

  if (options?.limit) {
    logs = logs.slice(0, options.limit);
  }

  return logs;
}

/**
 * Get dry-fire statistics
 */
export async function getDryFireStats(since?: Date): Promise<DryFireStats> {
  // Try cached stats first
  if (!since && inMemoryStats) {
    return inMemoryStats;
  }

  const logs = await getDryFireLogs({ since });
  const stats = calculateStats(logs, since?.toISOString());
  
  if (!since) {
    inMemoryStats = stats;
  }

  return stats;
}

/**
 * Calculate statistics from logs
 */
function calculateStats(logs: DryFireTradeLog[], since?: string): DryFireStats {
  const stats: DryFireStats = {
    dryFireModeEnabled: isDryFireModeActive(),
    totalSimulated: 0,
    totalRejectedBySafety: 0,
    totalRejectedByRisk: 0,
    totalRejectedByValidation: 0,
    byPlatform: {
      kalshi: { simulated: 0, rejected: 0 },
      polymarket: { simulated: 0, rejected: 0 },
      sxbet: { simulated: 0, rejected: 0 },
    },
    profitBuckets: {
      '0-25bps': 0,
      '25-50bps': 0,
      '50-100bps': 0,
      '100-200bps': 0,
      '200+bps': 0,
    },
    totalPotentialProfitUsd: 0,
    avgProfitPerTradeUsd: 0,
    generatedAt: new Date().toISOString(),
    since,
  };

  for (const log of logs) {
    // Count by status
    switch (log.status) {
      case 'SIMULATED':
        stats.totalSimulated++;
        stats.totalPotentialProfitUsd += log.expectedProfitUsd;
        break;
      case 'REJECTED_BY_SAFETY':
        stats.totalRejectedBySafety++;
        break;
      case 'REJECTED_BY_RISK':
        stats.totalRejectedByRisk++;
        break;
      case 'REJECTED_BY_VALIDATION':
        stats.totalRejectedByValidation++;
        break;
    }

    // Count by platform
    for (const leg of log.legs) {
      if (log.status === 'SIMULATED') {
        stats.byPlatform[leg.platform].simulated++;
      } else {
        stats.byPlatform[leg.platform].rejected++;
      }
    }

    // Profit buckets (for simulated trades)
    if (log.status === 'SIMULATED') {
      const bps = log.expectedProfitBps;
      if (bps < 25) stats.profitBuckets['0-25bps']++;
      else if (bps < 50) stats.profitBuckets['25-50bps']++;
      else if (bps < 100) stats.profitBuckets['50-100bps']++;
      else if (bps < 200) stats.profitBuckets['100-200bps']++;
      else stats.profitBuckets['200+bps']++;
    }
  }

  // Calculate average
  if (stats.totalSimulated > 0) {
    stats.avgProfitPerTradeUsd = stats.totalPotentialProfitUsd / stats.totalSimulated;
  }

  return stats;
}

/**
 * Update cached stats
 */
async function updateStatsCache(logs: DryFireTradeLog[]): Promise<void> {
  try {
    const stats = calculateStats(logs);
    const { kv } = await import('@upstash/redis');
    await kv.set(KV_DRY_FIRE_STATS_KEY, stats);
    inMemoryStats = stats;
  } catch {
    // Ignore cache update failures
  }
}

/**
 * Clear all dry-fire logs
 */
export async function clearDryFireLogs(): Promise<void> {
  try {
    const { kv } = await import('@upstash/redis');
    await kv.del(KV_DRY_FIRE_LOGS_KEY);
    await kv.del(KV_DRY_FIRE_STATS_KEY);
  } catch {
    // Ignore
  }
  inMemoryLogs = [];
  inMemoryStats = null;
}

// ============================================================================
// CSV Export
// ============================================================================

/**
 * Export dry-fire logs to CSV format
 */
export function exportDryFireLogsToCSV(logs: DryFireTradeLog[]): string {
  const headers = [
    'ID',
    'Created At',
    'Status',
    'Platform 1',
    'Market ID 1',
    'Title 1',
    'Side 1',
    'Price 1',
    'Stake 1',
    'Platform 2',
    'Market ID 2',
    'Title 2',
    'Side 2',
    'Price 2',
    'Stake 2',
    'Expected Profit USD',
    'Expected Profit %',
    'Total Investment',
    'Days to Expiry',
    'Is Live Event',
    'Reject Reasons',
  ];

  const rows = logs.map(log => {
    const leg1 = log.legs[0];
    const leg2 = log.legs[1];

    return [
      log.id,
      log.createdAt,
      log.status,
      leg1.platform,
      leg1.marketId,
      `"${leg1.title.replace(/"/g, '""')}"`,
      leg1.side,
      leg1.intendedPrice.toFixed(2),
      leg1.intendedStake.toFixed(2),
      leg2.platform,
      leg2.marketId,
      `"${leg2.title.replace(/"/g, '""')}"`,
      leg2.side,
      leg2.intendedPrice.toFixed(2),
      leg2.intendedStake.toFixed(2),
      log.expectedProfitUsd.toFixed(2),
      log.expectedProfitPct.toFixed(4),
      log.totalInvestment.toFixed(2),
      log.daysToExpiry.toFixed(2),
      log.isLiveEvent ? 'Yes' : 'No',
      `"${(log.rejectReasons || []).join('; ')}"`,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

