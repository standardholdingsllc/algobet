/**
 * Arb Opportunity Logger
 *
 * Logs detected arbitrage opportunities to Upstash KV using a date-partitioned list.
 * Key format: algobet:arbs:${YYYY-MM-DD}
 *
 * This provides:
 * - Daily partitioning for efficient queries
 * - All audit fields (timestamps, skew, leg ages)
 * - CSV export capability
 */

import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';
import { ArbitrageOpportunity, MarketPlatform } from '@/types';
import { LiveArbOpportunity } from '@/types/live-arb';
import { MatchedEventGroup } from '@/types/live-events';
import { calculateTotalCost } from './fees';

// ============================================================================
// Storage Key
// ============================================================================

const ARB_LOG_KEY_PREFIX = 'algobet:arbs';
const MAX_LOGS_PER_DAY = 10000;
const WORKER_VERSION = process.env.WORKER_VERSION || '1.0.0';

// ============================================================================
// Types
// ============================================================================

/**
 * A logged arb opportunity with all audit fields
 */
export interface ArbOpportunityLog {
  // Identity
  detectedAt: string; // ISO timestamp
  opportunityId: string;

  // Event info
  matchupKey: string;
  marketKind: 'prediction' | 'sportsbook';

  // Leg A
  platformA: MarketPlatform;
  marketIdA: string;
  outcomeA: 'yes' | 'no';
  sideA: 'yes' | 'no';
  rawPriceA: number;
  impliedProbA: number;
  asOfA: string; // ISO timestamp when price was captured
  ageMsA: number; // Age of price at detection time

  // Leg B
  platformB: MarketPlatform;
  marketIdB: string;
  outcomeB: 'yes' | 'no';
  sideB: 'yes' | 'no';
  rawPriceB: number;
  impliedProbB: number;
  asOfB: string;
  ageMsB: number;

  // Timing
  timeSkewMs: number; // |asOfA - asOfB| in milliseconds

  // Financials
  payoutTarget: number; // Target payout (typically $100)
  totalCost: number; // Sum of both legs
  profitAbs: number; // Absolute profit in dollars
  profitPct: number; // Profit as percentage

  // Fees
  feesA: number;
  feesB: number;

  // Metadata
  workerVersion: string;
}

// ============================================================================
// Redis Client
// ============================================================================

function fixEnvQuotes(value: string | undefined): string | undefined {
  if (!value) return value;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

const kvUrl = fixEnvQuotes(process.env.KV_REST_API_URL);
const kvToken = fixEnvQuotes(process.env.KV_REST_API_TOKEN);

const redis =
  kvUrl && kvToken
    ? new Redis({
        url: kvUrl,
        token: kvToken,
      })
    : null;

// ============================================================================
// Key Helpers
// ============================================================================

/**
 * Get the KV key for a specific date
 */
export function getArbLogKey(date: Date): string {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return `${ARB_LOG_KEY_PREFIX}:${dateStr}`;
}

/**
 * Get today's date string in YYYY-MM-DD format
 */
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

// ============================================================================
// Logging Functions
// ============================================================================

/**
 * Create an ArbOpportunityLog from an ArbitrageOpportunity
 */
export function createArbOpportunityLog(
  opportunity: ArbitrageOpportunity,
  options: {
    matchupKey?: string;
    priceTimestampA?: string;
    priceTimestampB?: string;
    betSizes?: { amount1: number; amount2: number };
  } = {}
): ArbOpportunityLog {
  const now = new Date();
  const nowMs = now.getTime();

  // Calculate prices
  const priceA =
    opportunity.side1 === 'yes'
      ? opportunity.market1.yesPrice
      : opportunity.market1.noPrice;
  const priceB =
    opportunity.side2 === 'yes'
      ? opportunity.market2.yesPrice
      : opportunity.market2.noPrice;

  // Calculate implied probabilities
  const isSportsbook1 = opportunity.market1.marketType === 'sportsbook';
  const isSportsbook2 = opportunity.market2.marketType === 'sportsbook';

  const impliedProbA = isSportsbook1 ? 1 / priceA : priceA / 100;
  const impliedProbB = isSportsbook2 ? 1 / priceB : priceB / 100;

  // Timestamps
  const asOfA = options.priceTimestampA || now.toISOString();
  const asOfB = options.priceTimestampB || now.toISOString();

  const asOfAMs = new Date(asOfA).getTime();
  const asOfBMs = new Date(asOfB).getTime();

  const ageMsA = Math.max(0, nowMs - asOfAMs);
  const ageMsB = Math.max(0, nowMs - asOfBMs);
  const timeSkewMs = Math.abs(asOfAMs - asOfBMs);

  // Calculate fees
  const fee1Result = calculateTotalCost(
    opportunity.market1.platform,
    opportunity.market1.ticker,
    priceA,
    options.betSizes?.amount1 || 1,
    false
  );
  const fee2Result = calculateTotalCost(
    opportunity.market2.platform,
    opportunity.market2.ticker,
    priceB,
    options.betSizes?.amount2 || 1,
    false
  );

  // Calculate total cost and profit
  const amount1 = options.betSizes?.amount1 || opportunity.betSize1;
  const amount2 = options.betSizes?.amount2 || opportunity.betSize2;
  const totalCost = amount1 + amount2;
  const payoutTarget = 100; // Standard payout target
  const profitAbs = opportunity.expectedProfit;
  // profitMargin is already a percentage (e.g., 1.25 means 1.25%), so don't multiply by 100
  const profitPct = opportunity.profitMargin;

  return {
    detectedAt: now.toISOString(),
    opportunityId: opportunity.id || uuidv4(),

    matchupKey: options.matchupKey || opportunity.market1.title,
    marketKind:
      opportunity.market1.marketType === 'sportsbook' ||
      opportunity.market2.marketType === 'sportsbook'
        ? 'sportsbook'
        : 'prediction',

    platformA: opportunity.market1.platform,
    marketIdA: opportunity.market1.id,
    outcomeA: opportunity.side1,
    sideA: opportunity.side1,
    rawPriceA: priceA,
    impliedProbA,
    asOfA,
    ageMsA,

    platformB: opportunity.market2.platform,
    marketIdB: opportunity.market2.id,
    outcomeB: opportunity.side2,
    sideB: opportunity.side2,
    rawPriceB: priceB,
    impliedProbB,
    asOfB,
    ageMsB,

    timeSkewMs,

    payoutTarget,
    totalCost,
    profitAbs,
    profitPct,

    feesA: fee1Result.fee,
    feesB: fee2Result.fee,

    workerVersion: WORKER_VERSION,
  };
}

/**
 * Log an arb opportunity to KV
 */
export async function logArbOpportunity(
  log: ArbOpportunityLog
): Promise<boolean> {
  if (!redis) {
    console.warn('[ArbLogger] Redis not configured, skipping log');
    return false;
  }

  try {
    const key = getArbLogKey(new Date(log.detectedAt));

    // Use LPUSH to add to the front of the list
    await redis.lpush(key, JSON.stringify(log));

    // Trim to max size (keep most recent)
    await redis.ltrim(key, 0, MAX_LOGS_PER_DAY - 1);

    // Set TTL to 30 days
    await redis.expire(key, 30 * 24 * 60 * 60);

    console.log(
      `[ArbLogger] Logged opportunity: ${log.platformA} vs ${log.platformB} (${log.profitPct.toFixed(2)}%)`
    );
    return true;
  } catch (error) {
    console.error('[ArbLogger] Failed to log opportunity:', error);
    return false;
  }
}

/**
 * Log an opportunity from a LiveArbOpportunity (with richer metadata)
 */
export async function logLiveArbOpportunity(
  opportunity: LiveArbOpportunity,
  group?: MatchedEventGroup
): Promise<boolean> {
  const log = createArbOpportunityLog(opportunity, {
    matchupKey: group?.eventKey || opportunity.market1.title,
    priceTimestampA: opportunity.market1.oddsAsOf,
    priceTimestampB: opportunity.market2.oddsAsOf,
    betSizes: {
      amount1: opportunity.betSize1,
      amount2: opportunity.betSize2,
    },
  });

  return logArbOpportunity(log);
}

// ============================================================================
// Query Functions
// ============================================================================

export interface GetArbLogsOptions {
  date?: string; // YYYY-MM-DD format
  limit?: number;
  cursor?: number; // Start index for pagination
}

export interface GetArbLogsResult {
  logs: ArbOpportunityLog[];
  total: number;
  cursor?: number; // Next cursor for pagination
  hasMore: boolean;
}

/**
 * Get arb opportunity logs for a specific date
 */
export async function getArbLogs(
  options: GetArbLogsOptions = {}
): Promise<GetArbLogsResult> {
  if (!redis) {
    return { logs: [], total: 0, hasMore: false };
  }

  const dateStr = options.date || getTodayDateString();
  const key = `${ARB_LOG_KEY_PREFIX}:${dateStr}`;
  const limit = options.limit || 100;
  const start = options.cursor || 0;
  const end = start + limit - 1;

  try {
    // Get total count
    const total = await redis.llen(key);

    // Get logs in range
    const rawLogs = await redis.lrange(key, start, end);

    const logs: ArbOpportunityLog[] = rawLogs.map((raw) => {
      if (typeof raw === 'string') {
        return JSON.parse(raw);
      }
      return raw as ArbOpportunityLog;
    });

    const nextCursor = start + logs.length;
    const hasMore = nextCursor < total;

    return {
      logs,
      total,
      cursor: hasMore ? nextCursor : undefined,
      hasMore,
    };
  } catch (error) {
    console.error('[ArbLogger] Failed to get logs:', error);
    return { logs: [], total: 0, hasMore: false };
  }
}

/**
 * Get all arb logs for a date (for CSV export)
 */
export async function getAllArbLogsForDate(
  date: string
): Promise<ArbOpportunityLog[]> {
  if (!redis) {
    return [];
  }

  const key = `${ARB_LOG_KEY_PREFIX}:${date}`;

  try {
    const rawLogs = await redis.lrange(key, 0, -1);

    return rawLogs.map((raw) => {
      if (typeof raw === 'string') {
        return JSON.parse(raw);
      }
      return raw as ArbOpportunityLog;
    });
  } catch (error) {
    console.error('[ArbLogger] Failed to get all logs:', error);
    return [];
  }
}

// ============================================================================
// CSV Export
// ============================================================================

const CSV_COLUMNS = [
  'detectedAt',
  'opportunityId',
  'matchupKey',
  'marketKind',
  'platformA',
  'marketIdA',
  'outcomeA',
  'sideA',
  'rawPriceA',
  'impliedProbA',
  'asOfA',
  'ageMsA',
  'platformB',
  'marketIdB',
  'outcomeB',
  'sideB',
  'rawPriceB',
  'impliedProbB',
  'asOfB',
  'ageMsB',
  'timeSkewMs',
  'payoutTarget',
  'totalCost',
  'profitAbs',
  'profitPct',
  'feesA',
  'feesB',
  'workerVersion',
] as const;

/**
 * Export logs to CSV format
 */
export function exportArbLogsToCSV(logs: ArbOpportunityLog[]): string {
  const headers = CSV_COLUMNS.join(',');

  const rows = logs.map((log) => {
    return CSV_COLUMNS.map((col) => {
      const value = log[col];
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'string') {
        // Escape quotes and wrap in quotes if contains comma or quote
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }
      if (typeof value === 'number') {
        return value.toString();
      }
      return String(value);
    }).join(',');
  });

  return [headers, ...rows].join('\n');
}
