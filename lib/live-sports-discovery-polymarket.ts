/**
 * Polymarket Live Sports Discovery
 * 
 * Efficiently discovers currently-live sports markets on Polymarket using the
 * Gamma API's event_date filter. This avoids crawling all markets by targeting
 * only today's (and yesterday's for UTC boundary) sports events.
 * 
 * Key insight from API exploration:
 * - Use `event_date` filter to get sports events for a specific day
 * - Events have `startTime` field indicating when the game starts
 * - Markets have `gameStartTime` and `sportsMarketType` for sports identification
 * - Query both today and yesterday to handle UTC timezone boundaries
 * 
 * @see docs/POLYMARKET_LIVE_SPORTS_DISCOVERY.md
 */

import {
  PolymarketEvent,
  PolymarketMarketData,
  PolymarketLiveMarket,
  PolymarketSport,
  LiveSportsDiscoveryConfig,
  LiveSportsDiscoveryResult,
  DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG,
} from '@/types/live-sports-discovery';

// ============================================================================
// Configuration
// ============================================================================

const GAMMA_BASE_URL = process.env.POLY_GAMMA_URL || 'https://gamma-api.polymarket.com';
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Sport code to human-readable name mapping
 */
export const POLYMARKET_SPORT_NAMES: Record<string, string> = {
  'ncaab': 'NCAA Basketball',
  'epl': 'English Premier League',
  'lal': 'La Liga',
  'nfl': 'NFL',
  'nba': 'NBA',
  'nhl': 'NHL',
  'mlb': 'MLB',
  'cfb': 'College Football',
  'ufc': 'UFC',
  'mma': 'MMA',
  'ten': 'Tennis',
  'golf': 'Golf',
  'mls': 'MLS',
  'wnba': 'WNBA',
  'bun': 'Bundesliga',
  'fl1': 'Ligue 1',
  'sea': 'Serie A',
  'ucl': 'Champions League',
  'ere': 'Eredivisie',
  'ipl': 'IPL Cricket',
};

// ============================================================================
// HTTP Client
// ============================================================================

let requestCount = 0;

/**
 * Make a GET request to the Gamma API
 */
async function gammaGet<T>(
  path: string,
  params: Record<string, string | number | boolean> = {}
): Promise<T> {
  const url = new URL(path, GAMMA_BASE_URL);
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, String(value));
    }
  });

  requestCount++;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AlgoBet-LiveDiscovery/1.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read response body');
      throw new Error(`Gamma API HTTP ${response.status} ${response.statusText}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Gamma API request timed out after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    }
    throw error;
  }
}

/**
 * Delay helper for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get today's date in YYYY-MM-DD format (UTC)
 */
function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get yesterday's date in YYYY-MM-DD format (UTC)
 */
function getYesterdayDateString(): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Parse a date string to Date object
 */
function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

// ============================================================================
// Live Detection Logic
// ============================================================================

/**
 * Determine if a market is currently LIVE based on Gamma fields.
 * 
 * A market is considered LIVE if:
 * 1. It has a sportsMarketType (confirmed sports market)
 * 2. It's not closed
 * 3. It's active
 * 4. gameStartTime exists and is in the past (game has started)
 * 5. gameStartTime is within maxGameDurationHours (game likely still in progress)
 */
export function isLiveSportsMarket(
  market: PolymarketMarketData,
  event: PolymarketEvent | undefined,
  now: Date,
  config: LiveSportsDiscoveryConfig = DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG
): boolean {
  // Must have sportsMarketType to be a confirmed sports market
  if (!market.sportsMarketType) {
    return false;
  }

  // Basic tradability checks
  if (market.closed === true) {
    return false;
  }
  
  if (market.active === false) {
    return false;
  }

  const nowMs = now.getTime();
  const toleranceMs = config.gameStartFutureToleranceMinutes * 60 * 1000;
  const maxDurationMs = config.maxGameDurationHours * 60 * 60 * 1000;

  // Check gameStartTime on market first
  const gameStartStr = market.gameStartTime || market.eventStartTime;
  if (gameStartStr) {
    const gameStart = parseDate(gameStartStr);
    if (gameStart) {
      const gameStartMs = gameStart.getTime();
      
      // Game must have started (with small tolerance for "about to start")
      if (gameStartMs > nowMs + toleranceMs) {
        return false;
      }
      
      // Game shouldn't have ended (based on max duration)
      if (gameStartMs + maxDurationMs < nowMs) {
        return false;
      }
      
      return true;
    }
  }

  // Fallback: check event.startTime
  if (event?.startTime) {
    const eventStart = parseDate(event.startTime);
    if (eventStart) {
      const eventStartMs = eventStart.getTime();
      
      // Event must have started (with small tolerance)
      if (eventStartMs > nowMs + toleranceMs) {
        return false;
      }
      
      // Event shouldn't have ended (based on max duration)
      if (eventStartMs + maxDurationMs < nowMs) {
        return false;
      }
      
      return true;
    }
  }

  // No timing info available - can't determine if live
  return false;
}

/**
 * Get the reason why a market is not live (for debugging)
 */
function getNonLiveReason(
  market: PolymarketMarketData,
  event: PolymarketEvent | undefined,
  now: Date,
  config: LiveSportsDiscoveryConfig
): string {
  if (!market.sportsMarketType) {
    return 'No sportsMarketType';
  }
  if (market.closed) {
    return 'Market closed';
  }
  if (market.active === false) {
    return 'Market not active';
  }

  const gameStartStr = market.gameStartTime || market.eventStartTime || event?.startTime;
  const gameStart = parseDate(gameStartStr);
  
  if (!gameStart) {
    return 'No start time';
  }

  const nowMs = now.getTime();
  const toleranceMs = config.gameStartFutureToleranceMinutes * 60 * 1000;
  const maxDurationMs = config.maxGameDurationHours * 60 * 60 * 1000;

  if (gameStart.getTime() > nowMs + toleranceMs) {
    return `Starts in future (${gameStart.toISOString()})`;
  }
  
  if (gameStart.getTime() + maxDurationMs < nowMs) {
    return `Game likely ended (started ${gameStart.toISOString()})`;
  }

  return 'Unknown';
}

// ============================================================================
// Discovery Functions
// ============================================================================

/**
 * Discover sports configuration from Polymarket
 */
export async function discoverPolymarketSports(): Promise<PolymarketSport[]> {
  try {
    interface GammaSport {
      id: number;
      sport: string;
      tags?: string;
      series?: string;
    }
    
    const sportsData = await gammaGet<GammaSport[]>('/sports');
    
    return sportsData.map(sport => ({
      code: sport.sport,
      name: POLYMARKET_SPORT_NAMES[sport.sport] || sport.sport.toUpperCase(),
      seriesId: sport.series,
      tagIds: sport.tags ? sport.tags.split(',').map(t => t.trim()) : [],
    }));
  } catch (error) {
    console.warn('[Polymarket-Discovery] Failed to fetch sports:', error);
    return [];
  }
}

/**
 * Fetch events for a specific date
 */
async function fetchEventsForDate(
  eventDate: string,
  config: LiveSportsDiscoveryConfig
): Promise<PolymarketEvent[]> {
  const allEvents: PolymarketEvent[] = [];
  
  for (let page = 0; page < config.maxPages; page++) {
    if (page > 0) {
      await delay(config.requestDelayMs);
    }
    
    try {
      type EventsResponse = PolymarketEvent[] | { events?: PolymarketEvent[]; data?: PolymarketEvent[] };
      
      const response = await gammaGet<EventsResponse>('/events', {
        event_date: eventDate,
        active: true,
        closed: false,
        limit: config.eventsPerPage,
        offset: page * config.eventsPerPage,
      });
      
      // Handle both array and object response formats
      const events: PolymarketEvent[] = Array.isArray(response)
        ? response
        : (response.events || response.data || []);
      
      if (events.length === 0) {
        break;
      }
      
      allEvents.push(...events);
      
      // If fewer than limit, no more pages
      if (events.length < config.eventsPerPage) {
        break;
      }
    } catch (error) {
      console.warn(`[Polymarket-Discovery] Error fetching page ${page + 1} for ${eventDate}:`, error);
      break;
    }
  }
  
  return allEvents;
}

/**
 * Discover currently-live sports markets on Polymarket
 * 
 * This is the main entry point for Polymarket live sports discovery.
 * It queries today's and yesterday's events to handle UTC timezone boundaries.
 */
export async function discoverPolymarketLiveSports(
  config: Partial<LiveSportsDiscoveryConfig> = {}
): Promise<LiveSportsDiscoveryResult<PolymarketLiveMarket>> {
  const cfg: LiveSportsDiscoveryConfig = {
    ...DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG,
    ...config,
  };
  
  const now = new Date();
  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();
  
  // Reset request count for this discovery run
  requestCount = 0;
  
  // Tracking
  let eventsFetched = 0;
  let eventsWithStartTimeInPast = 0;
  let marketsInspected = 0;
  const liveMarkets: PolymarketLiveMarket[] = [];
  const uniqueSportsMarketTypes = new Set<string>();
  const nearMisses: Array<{ title: string; reason: string }> = [];
  
  // Dates to query (today + yesterday for UTC boundary handling)
  const datesToQuery = cfg.queryYesterday ? [today, yesterday] : [today];
  
  console.log(`[Polymarket-Discovery] Discovering live sports for ${datesToQuery.join(', ')}...`);
  
  for (const eventDate of datesToQuery) {
    const events = await fetchEventsForDate(eventDate, cfg);
    eventsFetched += events.length;
    
    // Early stop check
    if (liveMarkets.length >= cfg.earlyStopLiveMarkets) {
      console.log(`[Polymarket-Discovery] Early stop: found ${liveMarkets.length} live markets`);
      break;
    }
    
    // Process events
    for (const event of events) {
      const markets = event.markets || [];
      marketsInspected += markets.length;
      
      // Check if event has started
      const eventStarted = event.startTime
        ? (parseDate(event.startTime)?.getTime() || Infinity) <= now.getTime() + cfg.gameStartFutureToleranceMinutes * 60 * 1000
        : false;
      
      if (eventStarted) {
        eventsWithStartTimeInPast++;
      }
      
      // Process markets
      for (const market of markets) {
        if (market.sportsMarketType) {
          uniqueSportsMarketTypes.add(market.sportsMarketType);
        }
        
        if (isLiveSportsMarket(market, event, now, cfg)) {
          liveMarkets.push({
            id: market.id,
            question: market.question,
            conditionId: market.conditionId,
            slug: market.slug,
            gameStartTime: market.gameStartTime,
            endDate: market.endDate || market.endDateIso,
            sportsMarketType: market.sportsMarketType,
            active: market.active,
            closed: market.closed,
            parentEvent: {
              id: event.id,
              title: event.title,
              startTime: event.startTime,
              eventDate: event.eventDate,
            },
          });
          
          // Early stop within event processing
          if (liveMarkets.length >= cfg.earlyStopLiveMarkets) {
            break;
          }
        } else if (market.sportsMarketType && nearMisses.length < 10) {
          nearMisses.push({
            title: market.question?.slice(0, 60) || event.title,
            reason: getNonLiveReason(market, event, now, cfg),
          });
        }
      }
      
      if (liveMarkets.length >= cfg.earlyStopLiveMarkets) {
        break;
      }
    }
  }
  
  console.log(
    `[Polymarket-Discovery] Found ${liveMarkets.length} live markets ` +
    `(${eventsFetched} events, ${marketsInspected} markets inspected, ${requestCount} requests)`
  );
  
  return {
    platform: 'polymarket',
    discoveredAt: now.toISOString(),
    liveMarkets,
    counts: {
      requestsMade: requestCount,
      eventsFetched,
      eventsWithStartTimeInPast,
      marketsInspected,
      liveMarketsFound: liveMarkets.length,
    },
    debug: {
      nearMisses,
      sportsMarketTypes: Array.from(uniqueSportsMarketTypes),
    },
  };
}

/**
 * Get the current request count (for testing/debugging)
 */
export function getPolymarketRequestCount(): number {
  return requestCount;
}

/**
 * Reset the request counter
 */
export function resetPolymarketRequestCount(): void {
  requestCount = 0;
}

