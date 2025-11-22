// Core types for the arbitrage bot

export interface Market {
  id: string;
  ticker: string; // Alias for id, used in many places
  platform: 'kalshi' | 'polymarket' | 'sxbet';
  marketType: 'prediction' | 'sportsbook';
  title: string;
  yesPrice: number; // Price for YES in cents (or decimal odds for sportsbook)
  noPrice: number;  // Price for NO in cents (or decimal odds for sportsbook)
  expiryDate: string;
  volume?: number;
  liquidity?: number;
}

export type MarketPlatform = Market['platform'];

export interface MarketFilterPreferences {
  sportsOnly?: boolean;
  categories?: string[];
  eventTypes?: string[];
  leagueTickers?: string[];
  maxMarkets?: number;
}

export interface MarketFilterInput {
  windowStart: string;
  windowEnd: string;
  maxMarkets?: number;
  sportsOnly?: boolean;
  categories?: string[];
  eventTypes?: string[];
  leagueTickers?: string[];
}

export type MarketFilterToken = keyof MarketFilterInput;

export interface FilterBinding {
  param: string;
  strategy?: 'direct' | 'boolean' | 'csv' | 'repeat';
  trueValue?: string | number | boolean;
  falseValue?: string | number | boolean;
  omitIfFalse?: boolean;
  joinWith?: string;
  format?: 'iso8601' | 'unixSeconds';
  extraParams?: string[];
}

export interface AdapterPaginationConfig {
  cursorParam?: string;
  nextCursorPath?: string;
  maxPages?: number;
  limitParam?: string;
  limit?: number;
}

export interface SnapshotMeta {
  rawMarkets?: number;
  withinWindow?: number;
  hydratedWithOdds?: number;
  stopReason?: string;
  pagesFetched?: number;
  writer?: string;
}

export interface MarketAdapterConfig {
  id: string;
  name: string;
  description?: string;
  adapterType: string;
  endpoint: string;
  method?: 'GET' | 'POST';
  staticParams?: Record<string, string | number | boolean>;
  filterBindings?: Partial<Record<MarketFilterToken, FilterBinding>>;
  pagination?: AdapterPaginationConfig;
  minMarkets?: number;
  notes?: string;
}

export interface PlatformSourceConfig {
  platform: MarketPlatform;
  docUrl?: string;
  defaultAdapter: string;
  supportedFilters: MarketFilterToken[];
  adapters: Record<string, MarketAdapterConfig>;
}

export type MarketSourceConfig = Record<MarketPlatform, PlatformSourceConfig>;

export interface ArbitrageOpportunity {
  id: string;
  market1: Market;
  market2: Market;
  side1: 'yes' | 'no';
  side2: 'yes' | 'no';
  profitMargin: number;
  profitPercentage: number; // Alias for profitMargin
  betSize1: number;
  betSize2: number;
  expectedProfit: number;
  netProfit: number; // Alias for expectedProfit
  timestamp: Date;
}

export interface Bet {
  id: string;
  arbitrageGroupId: string;
  platform: 'kalshi' | 'polymarket' | 'sxbet';
  marketId: string;
  marketTitle: string;
  ticker: string; // Market ticker/identifier
  side: 'yes' | 'no';
  price: number;
  amount: number;
  status: 'pending' | 'filled' | 'cancelled' | 'resolved';
  placedAt: Date;
  filledAt?: Date;
  resolvedAt?: Date;
  profit?: number;
}

export interface ArbitrageGroup {
  id: string;
  bet1: Bet;
  bet2: Bet;
  expectedProfit: number;
  actualProfit?: number;
  status: 'active' | 'resolved' | 'failed';
  createdAt: Date;
  resolvedAt?: Date;
}

export interface AccountBalance {
  platform: 'kalshi' | 'polymarket' | 'sxbet';
  balance: number; // Total value (cash + positions)
  availableCash?: number; // Cash available for new bets
  positionsValue?: number; // Current value of open positions
  lastUpdated: Date;
}

export interface BotConfig {
  maxBetPercentage: number; // Max % of balance to bet (default 10%)
  maxDaysToExpiry: number;   // Max days until market expiry to EXECUTE bets (default 10) - scans all markets but only bets on near-term
  minProfitMargin: number;   // Min profit margin to execute (default 1%)
  balanceThresholds: {
    kalshi: number;
    polymarket: number;
    sxbet: number;
  };
  emailAlerts: {
    enabled: boolean;
    lowBalanceAlert: boolean;
  };
  simulationMode: boolean;   // When true, logs opportunities without placing bets (default: false)
  marketFilters?: MarketFilterPreferences;
}

export interface DailyStats {
  date: string;
  totalBets: number;
  successfulArbitrages: number;
  totalProfit: number;
  averageProfit: number;
  volumeTraded: number;
}

/**
 * Tracked Market - A market that exists on multiple platforms and should be monitored constantly
 */
export interface TrackedMarket {
  id: string; // Unique ID for this tracked market
  normalizedTitle: string; // Normalized/cleaned title for grouping
  displayTitle: string; // Human-readable title
  platforms: TrackedPlatformMarket[]; // All platforms offering this market
  firstDetected: Date;
  expiryDate: Date;
  lastChecked: Date;
  opportunitiesFound: number; // Count of arbitrage opportunities found for this market
  isLive: boolean; // Is this a live event?
}

export interface TrackedPlatformMarket {
  platform: 'kalshi' | 'polymarket' | 'sxbet';
  marketId: string;
  market: Market; // Full market data
  lastUpdated: Date;
}

/**
 * Storage structure for tracked markets in GitHub
 */
export interface TrackedMarketsData {
  markets: TrackedMarket[];
  lastUpdated: Date;
}

/**
 * Opportunity Log - Records all arbitrage opportunities found (for simulation mode)
 */
export interface OpportunityLog {
  id: string;
  timestamp: Date;
  eventName: string; // Market title/event
  platform1: 'kalshi' | 'polymarket' | 'sxbet';
  platform2: 'kalshi' | 'polymarket' | 'sxbet';
  market1Id: string;
  market2Id: string;
  market1Side: 'yes' | 'no';
  market2Side: 'yes' | 'no';
  market1Price: number; // Price in cents or decimal odds
  market2Price: number;
  market1Type: 'prediction' | 'sportsbook';
  market2Type: 'prediction' | 'sportsbook';
  profitMargin: number; // Percentage
  estimatedProfit: number; // Dollar amount
  betSize1: number; // Dollar amount that would be bet
  betSize2: number;
  totalInvestment: number; // betSize1 + betSize2
  expiryDate: string;
  daysToExpiry: number;
  withinExecutionWindow: boolean; // Would this have been executed?
  skipReason?: string; // Why it was skipped (if applicable)
}

/**
 * DataStore - Main data structure for the dashboard
 */
export interface DataStore {
  opportunities: ArbitrageOpportunity[];
  bets: Bet[];
  balances: AccountBalance[];
  profits: ProfitData[];
  config: BotConfig;
}

export interface ProfitData {
  date: string;
  profit: number;
}

export interface MarketSnapshot {
  schemaVersion: number;
  platform: MarketPlatform;
  fetchedAt: string;
  maxDaysToExpiry?: number;
  adapterId?: string;
  filters?: MarketFilterInput;
  totalMarkets: number;
  markets: Market[];
  meta?: SnapshotMeta;
}