/**
 * Live Sports Discovery
 * 
 * Unified module for discovering currently-live sports markets across platforms.
 * This module coordinates the platform-specific discovery functions and provides
 * a single entry point for the live-arb worker.
 * 
 * Architecture:
 * - Polymarket: Uses event_date filter for today/yesterday's sports events
 * - Kalshi: Uses series_ticker filter for known sports game series
 * - Both platforms use time-based heuristics to determine if games are live
 * 
 * @see docs/POLYMARKET_LIVE_SPORTS_DISCOVERY.md
 * @see docs/KALSHI_API_LIVE_SPORTS.md
 */

import { Market } from '@/types';
import { VendorEvent, VendorEventStatus, Sport } from '@/types/live-events';
import {
  LiveSportsDiscoveryConfig,
  LiveSportsDiscoveryResult,
  CombinedLiveSportsResult,
  PolymarketLiveMarket,
  KalshiLiveEvent,
  DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG,
  getKalshiGameDurationHours,
} from '@/types/live-sports-discovery';
import {
  discoverPolymarketLiveSports,
  isLiveSportsMarket as isPolymarketLive,
} from './live-sports-discovery-polymarket';
import {
  discoverKalshiLiveSports,
  isLiveKalshiEvent,
  hasKalshiCredentials,
} from './live-sports-discovery-kalshi';
import { normalizeEventTitle } from './text-normalizer';
import { parseTeamsFromTitle, normalizeTeamName } from './live-event-matcher';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the current discovery configuration
 */
export function getDiscoveryConfig(
  overrides?: Partial<LiveSportsDiscoveryConfig>
): LiveSportsDiscoveryConfig {
  return {
    ...DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG,
    ...overrides,
  };
}

// ============================================================================
// Combined Discovery
// ============================================================================

/**
 * Discover live sports markets across all platforms
 * 
 * This is the main entry point for live sports discovery.
 * It runs discovery on both Polymarket and Kalshi in parallel.
 */
export async function discoverAllLiveSports(
  config?: Partial<LiveSportsDiscoveryConfig>
): Promise<CombinedLiveSportsResult> {
  const cfg = getDiscoveryConfig(config);
  const now = new Date();
  
  console.log('[LiveSportsDiscovery] Starting discovery across all platforms...');
  
  // Run discoveries in parallel
  const [polymarketResult, kalshiResult] = await Promise.all([
    discoverPolymarketLiveSports(cfg),
    hasKalshiCredentials()
      ? discoverKalshiLiveSports(cfg)
      : Promise.resolve<LiveSportsDiscoveryResult<KalshiLiveEvent>>({
          platform: 'kalshi',
          discoveredAt: now.toISOString(),
          liveMarkets: [],
          counts: {
            requestsMade: 0,
            eventsFetched: 0,
            eventsWithStartTimeInPast: 0,
            marketsInspected: 0,
            liveMarketsFound: 0,
          },
          debug: { seriesWithEvents: {} },
        }),
  ]);
  
  // Calculate total live markets
  const polymarketCount = polymarketResult.counts.liveMarketsFound;
  const kalshiCount = kalshiResult.counts.liveMarketsFound;
  const totalLiveMarkets = polymarketCount + kalshiCount;
  
  console.log(
    `[LiveSportsDiscovery] Discovery complete: ` +
    `Polymarket=${polymarketCount}, Kalshi=${kalshiCount}, Total=${totalLiveMarkets}`
  );
  
  return {
    polymarket: polymarketResult,
    kalshi: kalshiResult,
    totalLiveMarkets,
    discoveredAt: now.toISOString(),
  };
}

// ============================================================================
// Conversion to VendorEvents
// ============================================================================

/**
 * Sport detection patterns for title analysis
 */
const SPORT_DETECTION: Array<{ sport: Sport; patterns: RegExp[] }> = [
  { sport: 'NBA', patterns: [/\bnba\b/i, /basketball/i] },
  { sport: 'NFL', patterns: [/\bnfl\b/i, /\bfootball\b/i] },
  { sport: 'NHL', patterns: [/\bnhl\b/i, /\bhockey\b/i] },
  { sport: 'MLB', patterns: [/\bmlb\b/i, /\bbaseball\b/i] },
  { sport: 'MLS', patterns: [/\bmls\b/i] },
  { sport: 'EPL', patterns: [/\bpremier\s*league\b/i, /\bepl\b/i] },
  { sport: 'LALIGA', patterns: [/\bla\s*liga\b/i] },
  { sport: 'BUNDESLIGA', patterns: [/\bbundesliga\b/i] },
  { sport: 'SERIEA', patterns: [/\bserie\s*a\b/i] },
  { sport: 'UCL', patterns: [/\bchampions\s*league\b/i, /\bucl\b/i] },
  { sport: 'NCAA_FB', patterns: [/\b(ncaa|college)\s*football\b/i] },
  { sport: 'NCAA_BB', patterns: [/\b(ncaa|college)\s*basketball\b/i] },
  { sport: 'UFC', patterns: [/\bufc\b/i, /\bmma\b/i] },
  { sport: 'BOXING', patterns: [/\bboxing\b/i] },
  { sport: 'TENNIS', patterns: [/\btennis\b/i] },
  { sport: 'GOLF', patterns: [/\bgolf\b/i, /\bpga\b/i] },
];

/**
 * Detect sport from text
 */
function detectSport(text: string, seriesTicker?: string): Sport {
  // Check series ticker first
  if (seriesTicker) {
    const upper = seriesTicker.toUpperCase();
    if (upper.includes('NBA')) return 'NBA';
    if (upper.includes('NFL')) return 'NFL';
    if (upper.includes('NHL')) return 'NHL';
    if (upper.includes('MLB')) return 'MLB';
    if (upper.includes('MLS')) return 'MLS';
    if (upper.includes('EPL')) return 'EPL';
    if (upper.includes('UCL')) return 'UCL';
    if (upper.includes('NCAAF') || upper.includes('CFB')) return 'NCAA_FB';
    if (upper.includes('NCAAB') || upper.includes('CBB')) return 'NCAA_BB';
    if (upper.includes('UFC')) return 'UFC';
    if (upper.includes('BOXING') || upper.includes('BOX')) return 'BOXING';
    if (upper.includes('TENNIS')) return 'TENNIS';
    if (upper.includes('GOLF') || upper.includes('PGA')) return 'GOLF';
  }
  
  // Check title patterns
  const lowerText = text.toLowerCase();
  for (const { sport, patterns } of SPORT_DETECTION) {
    for (const pattern of patterns) {
      if (pattern.test(lowerText)) {
        return sport;
      }
    }
  }
  
  return 'OTHER';
}

/**
 * Detect market type from title
 */
function detectMarketType(title: string): 'MONEYLINE' | 'SPREAD' | 'TOTAL' | 'PROP' | 'OTHER' {
  const lower = title.toLowerCase();
  if (/\b(spread|handicap|line)\b/.test(lower)) return 'SPREAD';
  if (/\b(over|under|total|o\/u)\b/.test(lower)) return 'TOTAL';
  if (/\b(prop|player|first|last|most)\b/.test(lower)) return 'PROP';
  if (/\b(win|winner|moneyline|ml)\b/.test(lower) || /\bvs\.?\b/.test(lower)) return 'MONEYLINE';
  return 'OTHER';
}

/**
 * Convert Polymarket live markets to VendorEvents
 */
export function polymarketLiveMarketsToVendorEvents(
  liveMarkets: PolymarketLiveMarket[]
): VendorEvent[] {
  const events: VendorEvent[] = [];
  const now = Date.now();
  
  for (const market of liveMarkets) {
    const title = market.question || market.parentEvent?.title || '';
    const sport = detectSport(title);
    const { home, away, teams } = parseTeamsFromTitle(title, sport);
    const { normalizedTitle, tokens } = normalizeEventTitle(title, { sport });
    
    // Parse start time
    let startTime: number | undefined;
    if (market.gameStartTime) {
      const parsed = new Date(market.gameStartTime).getTime();
      if (!isNaN(parsed)) {
        startTime = parsed;
      }
    } else if (market.parentEvent?.startTime) {
      const parsed = new Date(market.parentEvent.startTime).getTime();
      if (!isNaN(parsed)) {
        startTime = parsed;
      }
    }
    
    events.push({
      platform: 'POLYMARKET',
      vendorMarketId: market.conditionId || market.id,
      sport,
      league: undefined,
      homeTeam: home,
      awayTeam: away,
      teams,
      startTime,
      status: 'LIVE' as VendorEventStatus, // These are already filtered to live
      marketType: detectMarketType(title),
      rawTitle: title,
      normalizedTitle,
      normalizedTokens: tokens,
      extra: {
        sportsMarketType: market.sportsMarketType,
        parentEventId: market.parentEvent?.id,
        parentEventTitle: market.parentEvent?.title,
      },
      lastUpdatedAt: now,
      extractionConfidence: 0.9,
    });
  }
  
  return events;
}

/**
 * Convert Kalshi live events to VendorEvents
 */
export function kalshiLiveEventsToVendorEvents(
  liveEvents: KalshiLiveEvent[]
): VendorEvent[] {
  const events: VendorEvent[] = [];
  const now = Date.now();
  
  for (const event of liveEvents) {
    for (const market of event.markets) {
      const title = market.title || event.title;
      const sport = detectSport(title, event.series_ticker);
      const { home, away, teams } = parseTeamsFromTitle(title, sport);
      const { normalizedTitle, tokens } = normalizeEventTitle(title, { sport });
      
      // Parse start time from estimated_start_time
      let startTime: number | undefined;
      if (event.estimated_start_time) {
        const parsed = new Date(event.estimated_start_time).getTime();
        if (!isNaN(parsed)) {
          startTime = parsed;
        }
      }
      
      events.push({
        platform: 'KALSHI',
        vendorMarketId: market.ticker,
        sport,
        league: event.series_ticker,
        homeTeam: home,
        awayTeam: away,
        teams,
        startTime,
        status: 'LIVE' as VendorEventStatus, // These are already filtered to live
        marketType: detectMarketType(title),
        rawTitle: title,
        normalizedTitle,
        normalizedTokens: tokens,
        extra: {
          event_ticker: event.event_ticker,
          series_ticker: event.series_ticker,
          expected_expiration_time: market.expected_expiration_time,
          yes_price: market.yes_price,
          no_price: market.no_price,
        },
        lastUpdatedAt: now,
        extractionConfidence: 0.95,
      });
    }
  }
  
  return events;
}

/**
 * Convert discovery results to VendorEvents for registry population
 */
export function discoveryResultsToVendorEvents(
  result: CombinedLiveSportsResult
): VendorEvent[] {
  const polymarketEvents = polymarketLiveMarketsToVendorEvents(result.polymarket.liveMarkets);
  const kalshiEvents = kalshiLiveEventsToVendorEvents(result.kalshi.liveMarkets);
  
  return [...polymarketEvents, ...kalshiEvents];
}

// ============================================================================
// Integration with Existing Market Objects
// ============================================================================

/**
 * Check if a normalized Market object represents a live sports event
 * 
 * This function can be used to filter existing Market objects
 * that were fetched through the standard market fetcher.
 */
export function isLiveMarket(
  market: Market,
  now: Date = new Date(),
  config: LiveSportsDiscoveryConfig = DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG
): boolean {
  // Must have eventStartTime or expiryDate
  const startTimeStr = market.eventStartTime || market.expiryDate;
  if (!startTimeStr) {
    return false;
  }
  
  const startTime = new Date(startTimeStr).getTime();
  if (isNaN(startTime)) {
    return false;
  }
  
  const nowMs = now.getTime();
  const toleranceMs = config.gameStartFutureToleranceMinutes * 60 * 1000;
  const maxDurationMs = config.maxGameDurationHours * 60 * 60 * 1000;
  
  // For Kalshi markets, use the expected_expiration_time logic
  if (market.platform === 'kalshi') {
    const vendorMeta = market.vendorMetadata as Record<string, unknown> | undefined;
    const expectedExpiration = vendorMeta?.expected_expiration_time as string | undefined;
    
    if (expectedExpiration) {
      const expMs = new Date(expectedExpiration).getTime();
      if (!isNaN(expMs)) {
        const seriesTicker = (vendorMeta?.kalshiSeriesTicker as string) || '';
        const gameDurationHours = getKalshiGameDurationHours(seriesTicker);
        const gameDurationMs = gameDurationHours * 60 * 60 * 1000;
        const bufferMs = config.liveBufferHours * 60 * 60 * 1000;
        
        const estimatedStart = expMs - gameDurationMs;
        const startWindow = estimatedStart - bufferMs;
        const endWindow = expMs + bufferMs;
        
        return nowMs >= startWindow && nowMs <= endWindow;
      }
    }
  }
  
  // Default heuristic: game started and within max duration
  const gameStarted = startTime <= nowMs + toleranceMs;
  const gameNotEnded = startTime + maxDurationMs >= nowMs;
  
  return gameStarted && gameNotEnded;
}

/**
 * Filter a list of markets to only include live sports events
 */
export function filterToLiveMarkets(
  markets: Market[],
  config?: Partial<LiveSportsDiscoveryConfig>
): Market[] {
  const cfg = getDiscoveryConfig(config);
  const now = new Date();
  
  return markets.filter(market => {
    // Must be sportsbook or have sports-like title
    const isSportsLike = 
      market.marketType === 'sportsbook' ||
      /\b(vs|@|versus)\b/i.test(market.title);
    
    if (!isSportsLike) {
      return false;
    }
    
    return isLiveMarket(market, now, cfg);
  });
}

// ============================================================================
// Exports
// ============================================================================

export {
  discoverPolymarketLiveSports,
  discoverKalshiLiveSports,
  hasKalshiCredentials,
  isPolymarketLive,
  isLiveKalshiEvent,
  DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG,
};

