/**
 * Live Sports Discovery Types
 * 
 * Types for the efficient live sports market discovery system.
 * These types support targeted API queries to find in-play games
 * without crawling all markets.
 */

// ============================================================================
// Common Types
// ============================================================================

/**
 * Status of a live sports market/event
 */
export type LiveSportsStatus = 'PRE' | 'LIVE' | 'ENDED';

/**
 * Platform identifier for live sports discovery
 */
export type LiveSportsPlatform = 'polymarket' | 'kalshi';

/**
 * Sport type for categorization
 */
export type LiveSportType = 
  | 'nfl' | 'nba' | 'nhl' | 'mlb' | 'mls' | 'wnba'
  | 'ncaaf' | 'ncaab' | 'ncaaw'
  | 'epl' | 'laliga' | 'bundesliga' | 'seriea' | 'ligue1' | 'ucl' | 'ligamx'
  | 'ufc' | 'boxing' | 'mma' | 'pfl' | 'bellator'
  | 'tennis' | 'golf' | 'pga' | 'f1' | 'nascar' | 'indycar'
  | 'rugby' | 'cricket'
  | 'lol' | 'csgo' | 'dota2' | 'esports'
  | 'other';

// ============================================================================
// Polymarket Types
// ============================================================================

/**
 * Polymarket Sport configuration from /sports endpoint
 */
export interface PolymarketSport {
  code: string;
  name: string;
  seriesId?: string;
  tagIds: string[];
}

/**
 * Polymarket Event with nested markets
 */
export interface PolymarketEvent {
  id: string;
  title: string;
  slug?: string;
  startTime?: string;
  eventDate?: string;
  active?: boolean;
  closed?: boolean;
  markets?: PolymarketMarketData[];
}

/**
 * Polymarket Market data from events response
 */
export interface PolymarketMarketData {
  id: string;
  question: string;
  conditionId: string;
  slug?: string;
  gameStartTime?: string;
  eventStartTime?: string;
  endDate?: string;
  endDateIso?: string;
  sportsMarketType?: string;
  gameId?: string;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
}

/**
 * Live market snapshot for Polymarket
 */
export interface PolymarketLiveMarket {
  id: string;
  question: string;
  conditionId: string;
  slug?: string;
  gameStartTime?: string | null;
  endDate?: string | null;
  sportsMarketType?: string | null;
  active?: boolean;
  closed?: boolean;
  parentEvent?: {
    id: string;
    title: string;
    startTime?: string;
    eventDate?: string;
  };
}

// ============================================================================
// Kalshi Types
// ============================================================================

/**
 * Kalshi sports series ticker patterns
 */
export interface KalshiSeriesConfig {
  ticker: string;
  sport: LiveSportType;
  gameDurationHours: number;
  description?: string;
}

/**
 * Kalshi Event from /events endpoint
 */
export interface KalshiEventData {
  event_ticker: string;
  title: string;
  sub_title?: string;
  category?: string;
  series_ticker?: string;
  status?: string;
  strike_date?: string;
  close_time?: string;
  markets?: KalshiMarketData[];
}

/**
 * Kalshi Market data from events response
 */
export interface KalshiMarketData {
  ticker: string;
  event_ticker: string;
  title: string;
  status: string;
  close_time: string;
  open_time?: string;
  expected_expiration_time?: string;
  yes_price?: number;
  no_price?: number;
  series_ticker?: string;
}

/**
 * Live event snapshot for Kalshi
 */
export interface KalshiLiveEvent {
  event_ticker: string;
  title: string;
  series_ticker?: string;
  status?: string;
  strike_date?: string;
  expected_expiration_time?: string;
  estimated_start_time?: string;
  market_count: number;
  markets: KalshiLiveMarket[];
}

/**
 * Live market snapshot for Kalshi
 */
export interface KalshiLiveMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  status: string;
  series_ticker?: string;
  expected_expiration_time?: string;
  yes_price?: number;
  no_price?: number;
}

// ============================================================================
// Discovery Configuration
// ============================================================================

/**
 * Configuration for live sports discovery
 */
export interface LiveSportsDiscoveryConfig {
  /** Maximum game duration in hours (default 6) */
  maxGameDurationHours: number;
  
  /** Minutes of tolerance for "about to start" games (default 15) */
  gameStartFutureToleranceMinutes: number;
  
  /** Buffer hours for Kalshi live detection (default 1) */
  liveBufferHours: number;
  
  /** Maximum pages to fetch per platform (default 5) */
  maxPages: number;
  
  /** Events per page (default 100) */
  eventsPerPage: number;
  
  /** Early stop threshold for live markets (default 200) */
  earlyStopLiveMarkets: number;
  
  /** Request delay between API calls in ms (default 150) */
  requestDelayMs: number;
  
  /** Whether to query yesterday for UTC boundary handling */
  queryYesterday: boolean;
}

/**
 * Default discovery configuration
 */
export const DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG: LiveSportsDiscoveryConfig = {
  maxGameDurationHours: 6,
  gameStartFutureToleranceMinutes: 15,
  liveBufferHours: 1,
  maxPages: 5,
  eventsPerPage: 100,
  earlyStopLiveMarkets: 200,
  requestDelayMs: 150,
  queryYesterday: true,
};

// ============================================================================
// Discovery Results
// ============================================================================

/**
 * Result from live sports discovery
 */
export interface LiveSportsDiscoveryResult<T> {
  platform: LiveSportsPlatform;
  discoveredAt: string;
  liveMarkets: T[];
  counts: {
    requestsMade: number;
    eventsFetched: number;
    eventsWithStartTimeInPast: number;
    marketsInspected: number;
    liveMarketsFound: number;
  };
  debug?: {
    nearMisses?: Array<{ title: string; reason: string }>;
    sportsMarketTypes?: string[];
    seriesWithEvents?: Record<string, number>;
  };
}

/**
 * Combined result from all platforms
 */
export interface CombinedLiveSportsResult {
  polymarket?: LiveSportsDiscoveryResult<PolymarketLiveMarket>;
  kalshi?: LiveSportsDiscoveryResult<KalshiLiveEvent>;
  totalLiveMarkets?: number;
  discoveredAt?: string;
  timestamp?: string;
  duration?: number;
}

// ============================================================================
// Kalshi Series Configuration
// ============================================================================

/**
 * Known Kalshi sports game series with their configurations
 */
export const KALSHI_SPORTS_SERIES: KalshiSeriesConfig[] = [
  // Major US Sports
  { ticker: 'KXNFLGAME', sport: 'nfl', gameDurationHours: 4, description: 'NFL game winners' },
  { ticker: 'KXNBAGAME', sport: 'nba', gameDurationHours: 3, description: 'NBA game winners' },
  { ticker: 'KXNHLGAME', sport: 'nhl', gameDurationHours: 3, description: 'NHL game winners' },
  { ticker: 'KXMLBGAME', sport: 'mlb', gameDurationHours: 3.5, description: 'MLB game winners' },
  { ticker: 'KXWNBAGAME', sport: 'wnba', gameDurationHours: 2.5, description: 'WNBA game winners' },
  { ticker: 'KXMLSGAME', sport: 'mls', gameDurationHours: 2, description: 'MLS game winners' },
  
  // College Sports
  { ticker: 'KXNCAAFGAME', sport: 'ncaaf', gameDurationHours: 4, description: 'College football game winners' },
  { ticker: 'KXNCAABGAME', sport: 'ncaab', gameDurationHours: 2.5, description: 'College basketball (Men) game winners' },
  { ticker: 'KXNCAAWGAME', sport: 'ncaaw', gameDurationHours: 2.5, description: 'College basketball (Women) game winners' },
  { ticker: 'KXCFBGAME', sport: 'ncaaf', gameDurationHours: 4, description: 'College football (alternate)' },
  { ticker: 'KXCBBGAME', sport: 'ncaab', gameDurationHours: 2.5, description: 'College basketball (alternate)' },
  
  // European Soccer
  { ticker: 'KXEPLGAME', sport: 'epl', gameDurationHours: 2, description: 'English Premier League' },
  { ticker: 'KXLALIGAGAME', sport: 'laliga', gameDurationHours: 2, description: 'La Liga (Spain)' },
  { ticker: 'KXBUNDESLIGAGAME', sport: 'bundesliga', gameDurationHours: 2, description: 'Bundesliga (Germany)' },
  { ticker: 'KXSABORAGAME', sport: 'seriea', gameDurationHours: 2, description: 'Serie A (Italy)' },
  { ticker: 'KXLIGUE1GAME', sport: 'ligue1', gameDurationHours: 2, description: 'Ligue 1 (France)' },
  { ticker: 'KXUCLGAME', sport: 'ucl', gameDurationHours: 2, description: 'UEFA Champions League' },
  { ticker: 'KXLIGAMXGAME', sport: 'ligamx', gameDurationHours: 2, description: 'Liga MX (Mexico)' },
  
  // Combat Sports
  { ticker: 'KXUFCFIGHT', sport: 'ufc', gameDurationHours: 4, description: 'UFC fights' },
  { ticker: 'KXUFC', sport: 'ufc', gameDurationHours: 4, description: 'UFC (alternate)' },
  { ticker: 'KXBOXING', sport: 'boxing', gameDurationHours: 4, description: 'Boxing matches' },
  { ticker: 'KXBOX', sport: 'boxing', gameDurationHours: 4, description: 'Boxing (alternate)' },
  { ticker: 'KXMMAFIGHT', sport: 'mma', gameDurationHours: 4, description: 'MMA fights (generic)' },
  { ticker: 'KXPFL', sport: 'pfl', gameDurationHours: 4, description: 'PFL fights' },
  { ticker: 'KXBELLATOR', sport: 'bellator', gameDurationHours: 4, description: 'Bellator fights' },
  
  // Individual Sports
  { ticker: 'KXTENNIS', sport: 'tennis', gameDurationHours: 4, description: 'Tennis matches' },
  { ticker: 'KXTENNISGAME', sport: 'tennis', gameDurationHours: 4, description: 'Tennis (alternate)' },
  { ticker: 'KXGOLF', sport: 'golf', gameDurationHours: 6, description: 'Golf tournaments' },
  { ticker: 'KXPGATOUR', sport: 'pga', gameDurationHours: 6, description: 'PGA Tour' },
  { ticker: 'KXF1RACE', sport: 'f1', gameDurationHours: 3, description: 'Formula 1 races' },
  { ticker: 'KXNASCAR', sport: 'nascar', gameDurationHours: 4, description: 'NASCAR races' },
  { ticker: 'KXINDYCAR', sport: 'indycar', gameDurationHours: 3, description: 'IndyCar races' },
  
  // Other Sports
  { ticker: 'KXRUGBY', sport: 'rugby', gameDurationHours: 2, description: 'Rugby matches' },
  { ticker: 'KXCRICKET', sport: 'cricket', gameDurationHours: 8, description: 'Cricket matches' },
  
  // Esports
  { ticker: 'KXLOLGAME', sport: 'lol', gameDurationHours: 2, description: 'League of Legends' },
  { ticker: 'KXCSGOGAME', sport: 'csgo', gameDurationHours: 3, description: 'CS:GO matches' },
  { ticker: 'KXDOTA2GAME', sport: 'dota2', gameDurationHours: 2, description: 'Dota 2 matches' },
  { ticker: 'KXESPORTS', sport: 'esports', gameDurationHours: 3, description: 'Esports (generic)' },
  
  // Generic soccer
  { ticker: 'KXSOCCER', sport: 'other', gameDurationHours: 2, description: 'Soccer matches (generic)' },
];

/**
 * Get game duration for a Kalshi series ticker
 */
export function getKalshiGameDurationHours(seriesTicker: string): number {
  const config = KALSHI_SPORTS_SERIES.find(s => 
    seriesTicker.toUpperCase().startsWith(s.ticker.toUpperCase())
  );
  return config?.gameDurationHours ?? 3; // Default 3 hours
}

/**
 * Get all Kalshi sports series tickers
 */
export function getKalshiSportsSeriesTickers(): string[] {
  return KALSHI_SPORTS_SERIES.map(s => s.ticker);
}
