/**
 * Live Events Types
 *
 * Types for the rule-based live sports matcher system.
 * This system deterministically matches events across platforms
 * (SX.bet, Polymarket, Kalshi) using sport, league, teams, and timing.
 *
 * No AI/ML is used - pure deterministic heuristics for reliability.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Platform identifier (uppercase for matching with existing types)
 */
export type LiveEventPlatform = 'SXBET' | 'POLYMARKET' | 'KALSHI';

/**
 * Convert to/from MarketPlatform
 */
export function toLiveEventPlatform(platform: 'sxbet' | 'polymarket' | 'kalshi'): LiveEventPlatform {
  return platform.toUpperCase() as LiveEventPlatform;
}

export function toMarketPlatform(platform: LiveEventPlatform): 'sxbet' | 'polymarket' | 'kalshi' {
  return platform.toLowerCase() as 'sxbet' | 'polymarket' | 'kalshi';
}

/**
 * Status of a vendor event
 */
export type VendorEventStatus = 'PRE' | 'LIVE' | 'ENDED';

/**
 * Supported sports
 */
export type Sport = 
  | 'NBA' 
  | 'NFL' 
  | 'NHL' 
  | 'MLB' 
  | 'MLS'
  | 'EPL'        // English Premier League
  | 'LALIGA'
  | 'BUNDESLIGA'
  | 'SERIEA'
  | 'LIGUE1'
  | 'UCL'        // UEFA Champions League
  | 'NCAA_FB'    // College Football
  | 'NCAA_BB'    // College Basketball
  | 'UFC'
  | 'BOXING'
  | 'TENNIS'
  | 'GOLF'
  | 'ESPORTS'
  | 'OTHER';

/**
 * Market type within an event
 */
export type EventMarketType = 
  | 'MONEYLINE'      // Who wins
  | 'SPREAD'         // Point spread
  | 'TOTAL'          // Over/under
  | 'PROP'           // Player/team props
  | 'OTHER';

// ============================================================================
// Vendor Event
// ============================================================================

/**
 * A single event from a specific vendor/platform
 */
export interface VendorEvent {
  /** Platform source */
  platform: LiveEventPlatform;

  /** Platform-specific market ID */
  vendorMarketId: string;

  /** Detected sport */
  sport: Sport;

  /** League/competition (e.g., "NBA", "Premier League") */
  league?: string;

  /** Home team (normalized) */
  homeTeam?: string;

  /** Away team (normalized) */
  awayTeam?: string;

  /** All detected team names (for matching flexibility) */
  teams: string[];

  /** Event start time (epoch ms) */
  startTime?: number;

  /** Current status */
  status: VendorEventStatus;

  /** Market type within the event */
  marketType: EventMarketType;

  /** Original market title/description */
  rawTitle: string;

  /** Platform-specific extra data */
  extra?: Record<string, unknown>;

  /** Last time this event was updated */
  lastUpdatedAt: number;

  /** Confidence score for sport/team extraction (0-1) */
  extractionConfidence: number;
}

// ============================================================================
// Matched Event Group
// ============================================================================

/**
 * A group of vendor events that represent the same real-world event
 */
export interface MatchedEventGroup {
  /** Canonical identifier for this matched event */
  eventKey: string;

  /** Detected sport */
  sport: Sport;

  /** League/competition */
  league?: string;

  /** Canonical home team name */
  homeTeam?: string;

  /** Canonical away team name */
  awayTeam?: string;

  /** Canonical start time (epoch ms) */
  startTime?: number;

  /** Current status (most authoritative across vendors) */
  status: VendorEventStatus;

  /** Events per platform */
  vendors: {
    SXBET?: VendorEvent[];
    POLYMARKET?: VendorEvent[];
    KALSHI?: VendorEvent[];
  };

  /** Number of platforms with events */
  platformCount: number;

  /** Total number of vendor events */
  totalEvents: number;

  /** When this group was last matched/updated */
  lastMatchedAt: number;

  /** Match quality score (0-1) */
  matchQuality: number;
}

// ============================================================================
// Registry Snapshot
// ============================================================================

/**
 * Snapshot of the live event registry
 */
export interface LiveEventRegistrySnapshot {
  /** All tracked events */
  events: VendorEvent[];

  /** When this snapshot was taken */
  updatedAt: number;

  /** Events by platform */
  countByPlatform: Record<LiveEventPlatform, number>;

  /** Events by status */
  countByStatus: Record<VendorEventStatus, number>;
}

// ============================================================================
// Watcher State
// ============================================================================

/**
 * State of an event watcher
 */
export type WatcherState = 'STARTING' | 'ACTIVE' | 'PAUSED' | 'STOPPING' | 'STOPPED';

/**
 * Information about an active event watcher
 */
export interface EventWatcherInfo {
  /** Event key being watched */
  eventKey: string;

  /** Current watcher state */
  state: WatcherState;

  /** When the watcher started */
  startedAt: number;

  /** Last price update received */
  lastPriceUpdateAt?: number;

  /** Last arb check performed */
  lastArbCheckAt?: number;

  /** Number of arb checks performed */
  arbCheckCount: number;

  /** Number of opportunities found */
  opportunitiesFound: number;

  /** Last opportunity details (if any) */
  lastOpportunity?: {
    profitMargin: number;
    platforms: string[];
    foundAt: number;
  };

  /** Platforms being watched */
  platforms: LiveEventPlatform[];

  /** Markets being monitored (count per platform) */
  marketCount: Record<LiveEventPlatform, number>;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the live event matcher
 */
export interface LiveEventMatcherConfig {
  /** Enable the rule-based matcher */
  enabled: boolean;

  /** Only match sports events */
  sportsOnly: boolean;

  /** Time tolerance for matching events (ms) */
  timeTolerance: number;

  /** Minimum similarity for team name matching (0-1) */
  minTeamSimilarity: number;

  /** Maximum number of active watchers */
  maxWatchers: number;

  /** Minimum platforms required for a match (typically 2) */
  minPlatforms: number;

  /** How often to refresh the registry (ms) */
  registryRefreshInterval: number;

  /** How often to run matching (ms) */
  matcherInterval: number;

  /** Pre-game window to include (ms before start time) */
  preGameWindow: number;

  /** Post-game window to keep ended events (ms) */
  postGameWindow: number;
}

/**
 * Default configuration
 */
export const DEFAULT_LIVE_EVENT_MATCHER_CONFIG: LiveEventMatcherConfig = {
  enabled: false,
  sportsOnly: true,
  timeTolerance: 15 * 60 * 1000,         // 15 minutes
  minTeamSimilarity: 0.7,
  maxWatchers: 50,
  minPlatforms: 2,
  registryRefreshInterval: 30 * 1000,    // 30 seconds
  matcherInterval: 10 * 1000,            // 10 seconds
  preGameWindow: 60 * 60 * 1000,         // 1 hour before
  postGameWindow: 5 * 60 * 1000,         // 5 minutes after
};

/**
 * Build config from environment variables
 */
export function buildLiveEventMatcherConfig(): LiveEventMatcherConfig {
  return {
    enabled: process.env.LIVE_RULE_BASED_MATCHER_ENABLED === 'true',
    sportsOnly: process.env.LIVE_RULE_BASED_SPORTS_ONLY !== 'false',
    timeTolerance: parseInt(process.env.LIVE_MATCH_TIME_TOLERANCE_MS || '900000', 10),
    minTeamSimilarity: parseFloat(process.env.LIVE_MIN_TEAM_SIMILARITY || '0.7'),
    maxWatchers: parseInt(process.env.LIVE_MAX_EVENT_WATCHERS || '50', 10),
    minPlatforms: parseInt(process.env.LIVE_MIN_PLATFORMS || '2', 10),
    registryRefreshInterval: parseInt(process.env.LIVE_REGISTRY_REFRESH_MS || '30000', 10),
    matcherInterval: parseInt(process.env.LIVE_MATCHER_INTERVAL_MS || '10000', 10),
    preGameWindow: parseInt(process.env.LIVE_PRE_GAME_WINDOW_MS || '3600000', 10),
    postGameWindow: parseInt(process.env.LIVE_POST_GAME_WINDOW_MS || '300000', 10),
  };
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Response from /api/live-arb/live-events
 */
export interface LiveEventsApiResponse {
  /** Whether the matcher is enabled */
  enabled: boolean;

  /** Current configuration */
  config: LiveEventMatcherConfig;

  /** Registry snapshot */
  registry: LiveEventRegistrySnapshot;

  /** Matched event groups */
  matchedGroups: MatchedEventGroup[];

  /** Active watchers */
  watchers: EventWatcherInfo[];

  /** Summary statistics */
  stats: {
    totalVendorEvents: number;
    liveEvents: number;
    preEvents: number;
    matchedGroups: number;
    activeWatchers: number;
    arbChecksTotal: number;
    opportunitiesTotal: number;
  };

  /** When this response was generated */
  generatedAt: number;
}

