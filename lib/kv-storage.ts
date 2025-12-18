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
import { buildLiveArbRuntimeSeed } from './live-arb-runtime-seed';

// Initialize Upstash Redis client
// Using Vercel's KV environment variables (set by Upstash integration)
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
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

export interface LiveArbWorkerHeartbeat {
  updatedAt: string;
  state: 'RUNNING' | 'STOPPED' | 'IDLE';
  liveArbEnabled?: boolean;
  ruleBasedMatcherEnabled?: boolean;
  liveEventsOnly?: boolean;
  sportsOnly?: boolean;
  refreshIntervalMs?: number;
  totalMarkets?: number;
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

