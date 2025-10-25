// Core types for the arbitrage bot

export interface Market {
  id: string;
  platform: 'kalshi' | 'polymarket' | 'sxbet';
  marketType: 'prediction' | 'sportsbook';
  title: string;
  yesPrice: number; // Price for YES in cents (or decimal odds for sportsbook)
  noPrice: number;  // Price for NO in cents (or decimal odds for sportsbook)
  expiryDate: string;
  volume?: number;
  liquidity?: number;
}

export interface ArbitrageOpportunity {
  id: string;
  market1: Market;
  market2: Market;
  side1: 'yes' | 'no';
  side2: 'yes' | 'no';
  profitMargin: number;
  betSize1: number;
  betSize2: number;
  expectedProfit: number;
  timestamp: Date;
}

export interface Bet {
  id: string;
  arbitrageGroupId: string;
  platform: 'kalshi' | 'polymarket' | 'sxbet';
  marketId: string;
  marketTitle: string;
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
  balance: number;
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
