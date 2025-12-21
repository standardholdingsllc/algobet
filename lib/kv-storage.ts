import { Redis } from '@upstash/redis';
import {
  Bet,
  ArbitrageGroup,
  BotConfig,
  DailyStats,
  AccountBalance,
  OpportunityLog,
  LiveArbRuntimeConfig,
} from '@/types';
import { DEFAULT_LIVE_ARB_RUNTIME_CONFIG } from '@/types/live-arb';
import { LiveEventPlatform, VendorEventStatus } from '@/types/live-events';
import { LiveEventsDebugCounters } from './live-events-debug';
import { buildLiveArbRuntimeSeed } from './live-arb-runtime-seed';

// Helper to fix double-quoted env vars (common .env parsing issue)
function fixEnvQuotes(value: string | undefined): string | undefined {
  if (!value) return value;
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// Initialize Upstash Redis client
// Using Vercel's KV environment variables (set by Upstash integration)
const kvUrl = fixEnvQuotes(process.env.KV_REST_API_URL);
const kvToken = fixEnvQuotes(process.env.KV_REST_API_TOKEN);

const redis = new Redis({
  url: kvUrl!,
  token: kvToken!,
});

interface StorageData {
  bets: Bet[];
  arbitrageGroups: ArbitrageGroup[];
  config: BotConfig;
  dailyStats: DailyStats[];
  balances: AccountBalance[];
  opportunityLogs: OpportunityLog[];
  liveArbRuntimeConfig?: LiveArbRuntimeConfig;
}

const DEFAULT_MARKET_FILTERS = {
  sportsOnly: false,
  categories: [] as string[],
  eventTypes: [] as string[],
  leagueTickers: [] as string[],
};

export const DEFAULT_BOT_CONFIG: BotConfig = {
  maxBetPercentage: 4, // 4% position sizing to stay conservative by default
  maxDaysToExpiry: 10,
  minProfitMargin: 0.5,
  balanceThresholds: {
    kalshi: 100,
    polymarket: 100,
    sxbet: 100,
  },
  emailAlerts: {
    enabled: true,
    lowBalanceAlert: true,
  },
  simulationMode: true,
  marketFilters: DEFAULT_MARKET_FILTERS,
  liveExecutionMode: 'DRY_FIRE', // Default to paper trading for safety
};

const DEFAULT_DATA: StorageData = {
  bets: [],
  arbitrageGroups: [],
  config: DEFAULT_BOT_CONFIG,
  dailyStats: [],
  balances: [],
  opportunityLogs: [],
  liveArbRuntimeConfig: DEFAULT_LIVE_ARB_RUNTIME_CONFIG,
};

/**
 * Previously this function forced all toggles to true (operational lock).
 * Now it just passes through the config to allow dashboard control.
 */
function enforceLiveArbAlwaysOn(
  config: LiveArbRuntimeConfig
): LiveArbRuntimeConfig {
  // No longer enforcing - allow dashboard to control start/stop
  return config;
}

const STORAGE_KEY = 'algobet:data';
const WORKER_HEARTBEAT_KEY = 'algobet:live-arb:worker-heartbeat';
const LIVE_EVENTS_SNAPSHOT_KEY = 'algobet:live-arb:live-events-snapshot';

/**
 * Platform connection status as reported by the worker.
 * This is persisted to KV so the serverless status API can read it.
 */
export interface WorkerPlatformStatus {
  connected: boolean;
  state: string;
  lastMessageAt: string | null;
  subscribedMarkets: number;
  errorMessage?: string;
  /** If the platform is disabled due to missing config */
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Price cache stats as reported by the worker.
 */
export interface WorkerPriceCacheStats {
  totalEntries: number;
  entriesByPlatform: Record<string, number>;
  totalPriceUpdates: number;
  oldestUpdateMs?: number;
  newestUpdateMs?: number;
  lastPriceUpdateAt?: string;
}

/**
 * Worker lifecycle states.
 * - STARTING: Worker is initializing (brief, during startup)
 * - RUNNING: Arb system is active
 * - IDLE: Worker is alive but arb is disabled (waiting for dashboard enable)
 * - STOPPING: Graceful shutdown in progress (SIGTERM/SIGINT received)
 * - STOPPED: Worker has stopped (final heartbeat before exit)
 */
export type WorkerState = 'STARTING' | 'RUNNING' | 'IDLE' | 'STOPPING' | 'STOPPED';

/**
 * Comprehensive worker heartbeat persisted to KV.
 * This is the source of truth for the serverless status API.
 * 
 * IMPORTANT: The heartbeat is written by a dedicated timer (every 5-10s)
 * that is DECOUPLED from the heavy refresh cycle. This ensures workerPresent
 * stays true even when refresh takes minutes.
 */
export interface LiveArbWorkerHeartbeat {
  /** ISO timestamp of when this heartbeat was written */
  updatedAt: string;
  /** Worker lifecycle state */
  state: WorkerState;
  /** Configured heartbeat interval in ms (for diagnostics) */
  heartbeatIntervalMs?: number;
  /** Monotonically increasing tick count - proves heartbeat loop is advancing */
  heartbeatTickCount?: number;
  
  // Shutdown metadata (populated during graceful shutdown)
  /** Reason for shutdown: SIGTERM, SIGINT, uncaughtException, unhandledRejection */
  shutdownReason?: string;
  /** ISO timestamp when shutdown began */
  shutdownStartedAt?: string;
  
  // Runtime config snapshot
  liveArbEnabled?: boolean;
  ruleBasedMatcherEnabled?: boolean;
  liveEventsOnly?: boolean;
  sportsOnly?: boolean;
  
  // Refresh cycle metadata (decoupled from heartbeat timing)
  /** Configured refresh interval in ms */
  refreshIntervalMs?: number;
  /** Whether a refresh is currently in progress */
  refreshInProgress?: boolean;
  /** ISO timestamp of last completed refresh */
  lastRefreshAt?: string;
  /** Duration of last refresh in ms */
  lastRefreshDurationMs?: number;
  /** Total markets from last refresh */
  totalMarkets?: number;
  
  /** Platform connection statuses - source of truth for dashboard */
  platforms?: {
    sxbet: WorkerPlatformStatus;
    polymarket: WorkerPlatformStatus;
    kalshi: WorkerPlatformStatus;
  };
  /** Price cache stats - source of truth for dashboard */
  priceCacheStats?: WorkerPriceCacheStats;
  /** Circuit breaker state */
  circuitBreaker?: {
    isOpen: boolean;
    consecutiveFailures: number;
    openReason?: string;
    openedAt?: string;
  };
  /** Live events pipeline statistics and debug counters */
  liveEventsStats?: {
    registry: {
      totalEvents: number;
      byPlatform: Record<LiveEventPlatform, number>;
      byStatus: Record<VendorEventStatus, number>;
      bySport: Record<string, number>;
      totalAdded: number;
      totalUpdated: number;
      totalRemoved: number;
    };
    matcher: {
      totalGroups: number;
      liveGroups: number;
      preGroups: number;
      by3Platforms: number;
      by2Platforms: number;
      bySport: Record<string, number>;
      lastRunAt: number;
    };
    watcher: {
      activeWatchers: number;
      totalArbChecks: number;
      totalOpportunities: number;
      avgChecksPerSecond: number;
      avgCheckTimeMs: number;
      maxCheckTimeMs: number;
      totalMarketsWatched: number;
    };
  };
  liveEventsDebug?: LiveEventsDebugCounters;
}

/** All valid worker states */
const VALID_WORKER_STATES: WorkerState[] = ['STARTING', 'RUNNING', 'IDLE', 'STOPPING', 'STOPPED'];

/**
 * Validate that a heartbeat payload has the required fields.
 * Used for runtime sanity checks.
 */
export function isValidWorkerHeartbeat(obj: unknown): obj is LiveArbWorkerHeartbeat {
  if (!obj || typeof obj !== 'object') return false;
  const hb = obj as Record<string, unknown>;
  return (
    typeof hb.updatedAt === 'string' &&
    typeof hb.state === 'string' &&
    VALID_WORKER_STATES.includes(hb.state as WorkerState)
  );
}

/**
 * Check if a heartbeat is fresh (within staleness threshold).
 * @param heartbeat The heartbeat to check
 * @param staleMs Maximum age in ms before considered stale (default 60000)
 */
export function isHeartbeatFresh(
  heartbeat: LiveArbWorkerHeartbeat | null,
  staleMs: number = 60000
): boolean {
  if (!heartbeat?.updatedAt) return false;
  const age = Date.now() - new Date(heartbeat.updatedAt).getTime();
  return age <= staleMs;
}

/**
 * In-memory cache for config (for synchronous access)
 * Updated whenever getConfig() is called
 */
let cachedConfig: BotConfig | null = null;
let lastConfigFetchAt = 0;
const CONFIG_CACHE_TTL_MS = 5000; // 5 seconds

/**
 * Get cached bot config synchronously
 * Returns the last fetched config, or null if never fetched
 */
export function getCachedBotConfig(): BotConfig | null {
  return cachedConfig;
}

/**
 * Upstash Redis Storage Adapter
 * Replaces GitHub storage for runtime data to prevent unnecessary rebuilds
 */
export class KVStorage {
  /**
   * Get all data from Redis store
   */
  static async getAllData(): Promise<StorageData> {
    try {
      const data = await redis.get<StorageData>(STORAGE_KEY);
      return data || DEFAULT_DATA;
    } catch (error) {
      console.error('Error reading from Redis store:', error);
      return DEFAULT_DATA;
    }
  }

  /**
   * Update all data in Redis store
   */
  static async updateAllData(data: StorageData): Promise<void> {
    try {
      await redis.set(STORAGE_KEY, data);
    } catch (error) {
      console.error('Error writing to Redis store:', error);
      throw error;
    }
  }

  /**
   * Get bets
   */
  static async getBets(): Promise<Bet[]> {
    const data = await this.getAllData();
    return data.bets || [];
  }

  /**
   * Add a new bet
   */
  static async addBet(bet: Bet): Promise<void> {
    const data = await this.getAllData();
    data.bets.push(bet);
    await this.updateAllData(data);
  }

  /**
   * Update an existing bet
   */
  static async updateBet(betId: string, updates: Partial<Bet>): Promise<void> {
    const data = await this.getAllData();
    const index = data.bets.findIndex(b => b.id === betId);
    if (index !== -1) {
      data.bets[index] = { ...data.bets[index], ...updates };
      await this.updateAllData(data);
    }
  }

  /**
   * Get arbitrage groups
   */
  static async getArbitrageGroups(): Promise<ArbitrageGroup[]> {
    const data = await this.getAllData();
    return data.arbitrageGroups || [];
  }

  /**
   * Add a new arbitrage group
   */
  static async addArbitrageGroup(group: ArbitrageGroup): Promise<void> {
    const data = await this.getAllData();
    data.arbitrageGroups.push(group);
    await this.updateAllData(data);
  }

  /**
   * Update an existing arbitrage group
   */
  static async updateArbitrageGroup(groupId: string, updates: Partial<ArbitrageGroup>): Promise<void> {
    const data = await this.getAllData();
    const index = data.arbitrageGroups.findIndex(g => g.id === groupId);
    if (index !== -1) {
      data.arbitrageGroups[index] = { ...data.arbitrageGroups[index], ...updates };
      await this.updateAllData(data);
    }
  }

  /**
   * Get bot configuration
   * Also updates the in-memory cache for synchronous access
   */
  static async getConfig(): Promise<BotConfig> {
    return getOrSeedBotConfig();
  }

  /**
   * Update bot configuration
   * Also updates the in-memory cache
   */
  static async updateConfig(config: Partial<BotConfig>): Promise<void> {
    const data = await this.getAllData();
    data.config = {
      ...DEFAULT_BOT_CONFIG,
      ...data.config,
      ...config,
      balanceThresholds: {
        ...DEFAULT_BOT_CONFIG.balanceThresholds,
        ...(data.config?.balanceThresholds ?? {}),
        ...(config.balanceThresholds ?? {}),
      },
      emailAlerts: {
        ...DEFAULT_BOT_CONFIG.emailAlerts,
        ...(data.config?.emailAlerts ?? {}),
        ...(config.emailAlerts ?? {}),
      },
    marketFilters: {
      ...DEFAULT_MARKET_FILTERS,
      ...(data.config?.marketFilters ?? {}),
      ...(config.marketFilters ?? {}),
      categories:
        config.marketFilters?.categories ??
        data.config?.marketFilters?.categories ??
        DEFAULT_MARKET_FILTERS.categories,
      eventTypes:
        config.marketFilters?.eventTypes ??
        data.config?.marketFilters?.eventTypes ??
        DEFAULT_MARKET_FILTERS.eventTypes,
      leagueTickers:
        config.marketFilters?.leagueTickers ??
        data.config?.marketFilters?.leagueTickers ??
        DEFAULT_MARKET_FILTERS.leagueTickers,
    },
    };
    await this.updateAllData(data);
    
    // Update cache
    cachedConfig = data.config;
    lastConfigFetchAt = Date.now();
  }

  /**
   * Get the live-arb runtime config (KV + UI controlled).
   * Seeds the store from env-derived defaults on first run.
   */
  static async getLiveArbRuntimeConfig(): Promise<LiveArbRuntimeConfig> {
    const data = await this.getAllData();
    if (!data.liveArbRuntimeConfig) {
      const seeded = buildLiveArbRuntimeSeed();
      const enforcedSeed = enforceLiveArbAlwaysOn(seeded);
      data.liveArbRuntimeConfig = enforcedSeed;
      await this.updateAllData(data);
      return enforcedSeed;
    }

    const current = data.liveArbRuntimeConfig;
    const enforced = enforceLiveArbAlwaysOn(current);

    if (current !== enforced) {
      data.liveArbRuntimeConfig = enforced;
      await this.updateAllData(data);
    }

    return enforced;
  }

  /**
   * Update the live-arb runtime config.
   */
  static async updateLiveArbRuntimeConfig(
    updates: Partial<LiveArbRuntimeConfig>
  ): Promise<LiveArbRuntimeConfig> {
    const data = await this.getAllData();
    const current = data.liveArbRuntimeConfig ?? buildLiveArbRuntimeSeed();
    const next = { ...current, ...updates };
    const enforced = enforceLiveArbAlwaysOn(next);
    data.liveArbRuntimeConfig = enforced;
    await this.updateAllData(data);
    return enforced;
  }

  /**
   * Get daily stats
   */
  static async getDailyStats(): Promise<DailyStats[]> {
    const data = await this.getAllData();
    return data.dailyStats || [];
  }

  /**
   * Add daily stats
   */
  static async addDailyStats(stats: DailyStats): Promise<void> {
    const data = await this.getAllData();
    // Remove existing stats for the same date
    data.dailyStats = data.dailyStats.filter(s => s.date !== stats.date);
    data.dailyStats.push(stats);
    await this.updateAllData(data);
  }

  /**
   * Get account balances
   */
  static async getBalances(): Promise<AccountBalance[]> {
    const data = await this.getAllData();
    return data.balances || [];
  }

  /**
   * Update account balances
   * This is called frequently and should NOT trigger rebuilds
   */
  static async updateBalances(balances: AccountBalance[]): Promise<void> {
    const data = await this.getAllData();
    data.balances = balances;
    await this.updateAllData(data);
  }

  /**
   * Get opportunity logs
   */
  static async getOpportunityLogs(): Promise<OpportunityLog[]> {
    const data = await this.getAllData();
    return data.opportunityLogs || [];
  }

  /**
   * Add opportunity log
   */
  static async addOpportunityLog(log: OpportunityLog): Promise<void> {
    const data = await this.getAllData();
    if (!data.opportunityLogs) {
      data.opportunityLogs = [];
    }
    data.opportunityLogs.push(log);
    await this.updateAllData(data);
  }

  /**
   * Clear opportunity logs
   */
  static async clearOpportunityLogs(): Promise<void> {
    const data = await this.getAllData();
    data.opportunityLogs = [];
    await this.updateAllData(data);
  }

  /**
   * Migrate data from GitHub storage to Upstash Redis
   * Run this once to transfer existing data
   */
  static async migrateFromGitHub(githubData: StorageData): Promise<void> {
    console.log('🔄 Migrating data from GitHub to Upstash Redis...');
    await this.updateAllData(githubData);
    console.log('✅ Migration complete!');
  }
}

function cloneDefaultData(): StorageData {
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function cloneDefaultBotConfig(): BotConfig {
  return JSON.parse(JSON.stringify(DEFAULT_BOT_CONFIG));
}

function cacheBotConfig(config: BotConfig): void {
  cachedConfig = config;
  lastConfigFetchAt = Date.now();
}

function mergeBotConfigWithDefaults(config?: BotConfig): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    ...(config ?? {}),
    balanceThresholds: {
      ...DEFAULT_BOT_CONFIG.balanceThresholds,
      ...(config?.balanceThresholds ?? {}),
    },
    emailAlerts: {
      ...DEFAULT_BOT_CONFIG.emailAlerts,
      ...(config?.emailAlerts ?? {}),
    },
    marketFilters: {
      ...DEFAULT_MARKET_FILTERS,
      ...(config?.marketFilters ?? {}),
      categories: config?.marketFilters?.categories ?? DEFAULT_MARKET_FILTERS.categories,
      eventTypes: config?.marketFilters?.eventTypes ?? DEFAULT_MARKET_FILTERS.eventTypes,
      leagueTickers: config?.marketFilters?.leagueTickers ?? DEFAULT_MARKET_FILTERS.leagueTickers,
    },
  };
}

function configsEqual(a?: BotConfig, b?: BotConfig): boolean {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function getOrSeedBotConfig(): Promise<BotConfig> {
  try {
    const rawData = await redis.get<StorageData>(STORAGE_KEY);

    if (!rawData) {
      const seededData = cloneDefaultData();
      await redis.set(STORAGE_KEY, seededData);
      cacheBotConfig(seededData.config);
      console.info('[KVStorage] BotConfig missing; seeded safe DRY_FIRE defaults.');
      return seededData.config;
    }

    const mergedConfig = mergeBotConfigWithDefaults(rawData.config);
    const needsPersist = !rawData.config || !configsEqual(rawData.config, mergedConfig);

    if (needsPersist) {
      const nextData: StorageData = {
        ...rawData,
        config: mergedConfig,
      };
      await redis.set(STORAGE_KEY, nextData);
      if (!rawData.config) {
        console.info('[KVStorage] BotConfig missing; seeded safe DRY_FIRE defaults.');
      }
    }

    cacheBotConfig(mergedConfig);
    return mergedConfig;
  } catch (error) {
    console.error('[KVStorage] Failed to read BotConfig from KV; using safe defaults', error);
    const fallback = cloneDefaultBotConfig();
    cacheBotConfig(fallback);
    return fallback;
  }
}

export async function updateWorkerHeartbeat(
  heartbeat: LiveArbWorkerHeartbeat
): Promise<void> {
  try {
    await redis.set(WORKER_HEARTBEAT_KEY, heartbeat);
  } catch (error) {
    console.error('[KVStorage] Failed to update worker heartbeat', error);
  }
}

export async function getWorkerHeartbeat(): Promise<LiveArbWorkerHeartbeat | null> {
  try {
    return (await redis.get<LiveArbWorkerHeartbeat>(WORKER_HEARTBEAT_KEY)) ?? null;
  } catch (error) {
    console.error('[KVStorage] Failed to read worker heartbeat', error);
    return null;
  }
}

// ============================================================================
// Live Events Snapshot (for cross-process visibility)
// ============================================================================

/**
 * Snapshot of live events data written by the worker for the API to read.
 * This enables the Vercel serverless API to display event data that only
 * exists in the worker's memory on Digital Ocean.
 */
export interface LiveEventsSnapshot {
  /** ISO timestamp when this snapshot was written */
  updatedAt: string;
  
  /** Registry snapshot - all tracked vendor events */
  registry: {
    totalEvents: number;
    events: Array<{
      platform: LiveEventPlatform;
      vendorMarketId: string;
      sport: string;
      status: VendorEventStatus;
      rawTitle: string;
      normalizedTitle?: string;
      startTime?: number;
      homeTeam?: string;
      awayTeam?: string;
    }>;
    countByPlatform: Record<LiveEventPlatform, number>;
    countByStatus: Record<VendorEventStatus, number>;
  };
  
  /** Matched event groups - cross-platform matches */
  matchedGroups: Array<{
    eventKey: string;
    sport: string;
    status: VendorEventStatus;
    homeTeam?: string;
    awayTeam?: string;
    platformCount: number;
    matchQuality: number;
    vendors: {
      SXBET?: Array<{ vendorMarketId: string; rawTitle: string }>;
      POLYMARKET?: Array<{ vendorMarketId: string; rawTitle: string }>;
      KALSHI?: Array<{ vendorMarketId: string; rawTitle: string }>;
    };
  }>;
  
  /** Active watchers */
  watchers: Array<{
    eventKey: string;
    sport: string;
    marketCount: number;
    lastCheckAt?: number;
  }>;
  
  /** Summary stats */
  stats: {
    totalVendorEvents: number;
    liveEvents: number;
    preEvents: number;
    endedEvents: number;
    matchedGroups: number;
    threeWayMatches: number;
    twoWayMatches: number;
    activeWatchers: number;
    arbChecksTotal: number;
    opportunitiesTotal: number;
  };
}

/**
 * Update the live events snapshot in KV.
 * Called by the worker after each registry refresh.
 */
export async function updateLiveEventsSnapshot(
  snapshot: LiveEventsSnapshot
): Promise<void> {
  try {
    await redis.set(LIVE_EVENTS_SNAPSHOT_KEY, snapshot);
  } catch (error) {
    console.error('[KVStorage] Failed to update live events snapshot', error);
  }
}

/**
 * Get the live events snapshot from KV.
 * Called by the API to display event data.
 */
export async function getLiveEventsSnapshot(): Promise<LiveEventsSnapshot | null> {
  try {
    return (await redis.get<LiveEventsSnapshot>(LIVE_EVENTS_SNAPSHOT_KEY)) ?? null;
  } catch (error) {
    console.error('[KVStorage] Failed to read live events snapshot', error);
    return null;
  }
}

