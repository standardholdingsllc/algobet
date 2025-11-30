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

const DEFAULT_CONFIG: BotConfig = {
  maxBetPercentage: 10,
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
  simulationMode: false,
  marketFilters: {
    sportsOnly: false,
    categories: [],
    eventTypes: [],
    leagueTickers: [],
  },
  matchGraphEnabled: false,
  liveExecutionMode: 'DRY_FIRE', // Default to paper trading for safety
};

const DEFAULT_DATA: StorageData = {
  bets: [],
  arbitrageGroups: [],
  config: DEFAULT_CONFIG,
  dailyStats: [],
  balances: [],
  opportunityLogs: [],
  liveArbRuntimeConfig: DEFAULT_LIVE_ARB_RUNTIME_CONFIG,
};

const STORAGE_KEY = 'algobet:data';

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
    const data = await this.getAllData();
    const config = { ...DEFAULT_CONFIG, ...data.config };
    
    // Update cache
    cachedConfig = config;
    lastConfigFetchAt = Date.now();
    
    return config;
  }

  /**
   * Update bot configuration
   * Also updates the in-memory cache
   */
  static async updateConfig(config: Partial<BotConfig>): Promise<void> {
    const data = await this.getAllData();
    data.config = { ...DEFAULT_CONFIG, ...data.config, ...config };
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
      data.liveArbRuntimeConfig = seeded;
      await this.updateAllData(data);
      return seeded;
    }
    return data.liveArbRuntimeConfig;
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
    data.liveArbRuntimeConfig = next;
    await this.updateAllData(data);
    return next;
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

