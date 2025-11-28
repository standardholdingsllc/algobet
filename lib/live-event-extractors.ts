/**
 * Live Event Extractors
 *
 * Vendor-specific functions to extract VendorEvents from market data.
 * Each extractor parses platform-specific data into the common VendorEvent format.
 *
 * FIELD MAPPINGS FOLLOW OFFICIAL API DOCS:
 * - SX.bet: https://api.docs.sx.bet/#introduction
 * - Polymarket: https://docs.polymarket.com/developers/CLOB/introduction
 * - Kalshi: https://docs.kalshi.com/welcome
 *
 * If you're uncertain about a field, check the docs and add a // NOTE comment.
 */

import {
  VendorEvent,
  VendorEventStatus,
  LiveEventPlatform,
  Sport,
  EventMarketType,
} from '@/types/live-events';
import { Market } from '@/types';
import { parseTeamsFromTitle, normalizeTeamName } from './live-event-matcher';
import { addOrUpdateEvent, markEventEnded } from './live-event-registry';

// ============================================================================
// Sport Detection
// ============================================================================

/** Patterns to detect sports from titles and metadata */
const SPORT_PATTERNS: { sport: Sport; patterns: RegExp[] }[] = [
  {
    sport: 'NBA',
    patterns: [
      /\bnba\b/i,
      /basketball/i,
      /\b(lakers|celtics|warriors|nets|bucks|heat|suns|sixers|76ers)\b/i,
    ],
  },
  {
    sport: 'NFL',
    patterns: [
      /\bnfl\b/i,
      /\bfootball\b/i,
      /\b(chiefs|eagles|49ers|cowboys|ravens|bills|dolphins|patriots)\b/i,
      /\bsuper\s*bowl\b/i,
    ],
  },
  {
    sport: 'NHL',
    patterns: [
      /\bnhl\b/i,
      /\bhockey\b/i,
      /\b(bruins|rangers|maple\s*leafs|oilers|avalanche|lightning)\b/i,
      /\bstanley\s*cup\b/i,
    ],
  },
  {
    sport: 'MLB',
    patterns: [
      /\bmlb\b/i,
      /\bbaseball\b/i,
      /\b(yankees|dodgers|red\s*sox|mets|cubs|astros|braves)\b/i,
      /\bworld\s*series\b/i,
    ],
  },
  {
    sport: 'MLS',
    patterns: [
      /\bmls\b/i,
      /\b(inter\s*miami|la\s*galaxy|atlanta\s*united|seattle\s*sounders)\b/i,
    ],
  },
  {
    sport: 'EPL',
    patterns: [
      /\b(premier\s*league|epl)\b/i,
      /\b(manchester\s*(united|city)|arsenal|chelsea|liverpool|tottenham)\b/i,
    ],
  },
  {
    sport: 'LALIGA',
    patterns: [
      /\bla\s*liga\b/i,
      /\b(real\s*madrid|barcelona|atletico\s*madrid)\b/i,
    ],
  },
  {
    sport: 'BUNDESLIGA',
    patterns: [
      /\bbundesliga\b/i,
      /\b(bayern\s*munich|borussia\s*dortmund)\b/i,
    ],
  },
  {
    sport: 'SERIEA',
    patterns: [
      /\bserie\s*a\b/i,
      /\b(juventus|inter\s*milan|ac\s*milan|napoli)\b/i,
    ],
  },
  {
    sport: 'UCL',
    patterns: [
      /\b(champions\s*league|ucl)\b/i,
      /\buefa\b/i,
    ],
  },
  {
    sport: 'NCAA_FB',
    patterns: [
      /\b(ncaa|college)\s*football\b/i,
      /\b(cfp|college\s*football\s*playoff)\b/i,
    ],
  },
  {
    sport: 'NCAA_BB',
    patterns: [
      /\b(ncaa|college)\s*basketball\b/i,
      /\bmarch\s*madness\b/i,
    ],
  },
  {
    sport: 'UFC',
    patterns: [
      /\bufc\b/i,
      /\bmma\b/i,
      /\bmixed\s*martial\s*arts\b/i,
    ],
  },
  {
    sport: 'BOXING',
    patterns: [
      /\bboxing\b/i,
      /\bfight\b/i,
    ],
  },
  {
    sport: 'TENNIS',
    patterns: [
      /\btennis\b/i,
      /\b(wimbledon|us\s*open|french\s*open|australian\s*open|atp|wta)\b/i,
    ],
  },
  {
    sport: 'GOLF',
    patterns: [
      /\bgolf\b/i,
      /\b(pga|masters|us\s*open\s*golf|british\s*open)\b/i,
    ],
  },
  {
    sport: 'ESPORTS',
    patterns: [
      /\besports?\b/i,
      /\b(league\s*of\s*legends|lol|dota|csgo|valorant|overwatch)\b/i,
    ],
  },
];

/**
 * Detect sport from text
 */
function detectSport(text: string, metadata?: Record<string, unknown>): { sport: Sport; confidence: number } {
  const lowerText = text.toLowerCase();
  
  // Check metadata first if available
  if (metadata?.sport) {
    const sportStr = String(metadata.sport).toUpperCase();
    const validSports: Sport[] = [
      'NBA', 'NFL', 'NHL', 'MLB', 'MLS', 'EPL', 'LALIGA', 
      'BUNDESLIGA', 'SERIEA', 'LIGUE1', 'UCL', 'NCAA_FB', 
      'NCAA_BB', 'UFC', 'BOXING', 'TENNIS', 'GOLF', 'ESPORTS'
    ];
    if (validSports.includes(sportStr as Sport)) {
      return { sport: sportStr as Sport, confidence: 0.95 };
    }
  }
  
  // Pattern matching
  for (const { sport, patterns } of SPORT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(lowerText)) {
        return { sport, confidence: 0.8 };
      }
    }
  }
  
  return { sport: 'OTHER', confidence: 0.3 };
}

/**
 * Detect market type from title
 */
function detectMarketType(title: string): EventMarketType {
  const lower = title.toLowerCase();
  
  if (/\b(spread|handicap|line)\b/.test(lower)) return 'SPREAD';
  if (/\b(over|under|total|o\/u)\b/.test(lower)) return 'TOTAL';
  if (/\b(prop|player|first|last|most)\b/.test(lower)) return 'PROP';
  if (/\b(win|winner|moneyline|ml)\b/.test(lower) || /\bvs\.?\b/.test(lower)) return 'MONEYLINE';
  
  return 'OTHER';
}

// ============================================================================
// SX.bet Extractor
// ============================================================================
// NOTE: Field mapping follows SX.bet API docs: https://api.docs.sx.bet/

/**
 * Extract VendorEvent from SX.bet market data
 *
 * SX.bet API fields (per docs):
 * - marketHash: Unique market identifier (use as vendorMarketId)
 * - outcomeOneName / outcomeTwoName: Team names
 * - gameTime: Game start time (Unix timestamp in seconds, multiply by 1000)
 * - sportLabel: Sport identifier (e.g., "basketball", "football")
 * - leagueLabel: League name (e.g., "NBA", "NFL")
 * - status: Market status (1=active, 2=inactive, 3=cancelled, 4=settled)
 * - title: Market title/question
 */
export function extractSxBetEvent(
  marketHash: string,
  title: string,
  metadata?: Record<string, unknown>
): VendorEvent | null {
  // Detect sport using provided labels first
  const sportLabel = metadata?.sportLabel ? String(metadata.sportLabel) : '';
  const leagueLabel = metadata?.leagueLabel ? String(metadata.leagueLabel) : '';
  const sportResult = detectSport(`${sportLabel} ${leagueLabel} ${title}`, {
    sport: leagueLabel || sportLabel,
  });

  // Parse teams from metadata or title
  let home: string | undefined;
  let away: string | undefined;
  let teams: string[] = [];

  if (metadata?.outcomeOneName && metadata?.outcomeTwoName) {
    home = normalizeTeamName(String(metadata.outcomeOneName), sportResult.sport);
    away = normalizeTeamName(String(metadata.outcomeTwoName), sportResult.sport);
    teams = [home, away];
  } else {
    const parsed = parseTeamsFromTitle(title, sportResult.sport);
    home = parsed.home;
    away = parsed.away;
    teams = parsed.teams;
  }
  
  // Skip non-sports or low confidence
  if (sportResult.sport === 'OTHER' && sportResult.confidence < 0.5) {
    return null;
  }
  
  // Parse start time
  // NOTE: SX.bet gameTime is Unix timestamp in seconds
  let startTime: number | undefined;
  if (metadata?.gameTime) {
    const gameTime = Number(metadata.gameTime);
    if (!isNaN(gameTime)) {
      // SX.bet uses seconds, convert to milliseconds
      startTime = gameTime > 1e12 ? gameTime : gameTime * 1000;
    }
  }
  
  // Detect status
  // NOTE: SX.bet status: 1=active, 2=inactive, 3=cancelled, 4=settled
  let status: VendorEventStatus = 'PRE';
  const sxStatus = metadata?.status ? Number(metadata.status) : undefined;
  
  if (sxStatus === 4 || sxStatus === 3) {
    status = 'ENDED';
  } else if (startTime) {
    const now = Date.now();
    const fourHoursMs = 4 * 60 * 60 * 1000;
    
    if (now >= startTime && now <= startTime + fourHoursMs) {
      status = 'LIVE';
    } else if (now > startTime + fourHoursMs) {
      status = 'ENDED';
    }
  }
  
  return {
    platform: 'SXBET',
    vendorMarketId: marketHash, // NOTE: marketHash is the canonical market ID
    sport: sportResult.sport,
    league: leagueLabel || undefined,
    homeTeam: home,
    awayTeam: away,
    teams,
    startTime,
    status,
    marketType: detectMarketType(title),
    rawTitle: title,
    extra: metadata,
    lastUpdatedAt: Date.now(),
    extractionConfidence: sportResult.confidence,
  };
}

/**
 * Process SX.bet markets into the registry
 */
export function processSxBetMarkets(markets: Market[]): number {
  let added = 0;
  
  for (const market of markets) {
    if (market.platform !== 'sxbet') continue;
    
    // Build metadata from what we have
    // NOTE: When market objects come from our normalized Market type,
    // we may not have all SX.bet-specific fields
    const metadata: Record<string, unknown> = {};
    if (market.expiryDate) {
      // Our expiryDate might be the gameTime estimate
      metadata.gameTime = new Date(market.expiryDate).getTime() / 1000;
    }
    
    const event = extractSxBetEvent(market.id, market.title, metadata);
    
    if (event && event.teams.length >= 2) {
      addOrUpdateEvent(event);
      added++;
    }
  }
  
  return added;
}

// ============================================================================
// Polymarket Extractor
// ============================================================================
// NOTE: Field mapping follows Polymarket CLOB docs: https://docs.polymarket.com/

/**
 * Extract VendorEvent from Polymarket market data
 *
 * Polymarket CLOB fields (per docs):
 * - conditionId: Unique condition identifier (use as vendorMarketId)
 * - question: Market question/title
 * - tokens: Array of outcome tokens
 * - closed: Whether market is closed
 * - active: Whether market is active
 * - resolved: Whether market is resolved
 * - endDate / endDateIso: Market end/resolution date
 * - startDate: Event start date (if sports)
 * - tags: Array of tags including category
 *
 * For sports markets, Polymarket may have additional metadata:
 * - gameStartTime: When the game starts
 * - category: Market category (e.g., "Sports")
 */
export function extractPolymarketEvent(
  conditionId: string,
  title: string,
  metadata?: Record<string, unknown>
): VendorEvent | null {
  // Check if tagged as sports
  const tags = (metadata?.tags as string[]) || [];
  const category = metadata?.category as string || '';
  const isSports = 
    tags.some(t => /sport|nba|nfl|nhl|mlb|soccer|football|basketball|baseball|hockey/i.test(t)) ||
    /sport/i.test(category);
  
  // Detect sport
  const sportResult = detectSport(title, { sport: category });
  
  // Parse teams from title with sport context
  const { home, away, teams } = parseTeamsFromTitle(title, sportResult.sport);
  
  // For Polymarket, we need sports tag or good detection with teams
  if (!isSports && sportResult.sport === 'OTHER') {
    return null;
  }
  
  // Parse start time
  // NOTE: Polymarket may have gameStartTime for sports, otherwise use endDate
  let startTime: number | undefined;
  if (metadata?.gameStartTime) {
    startTime = new Date(metadata.gameStartTime as string).getTime();
  } else if (metadata?.startDate) {
    startTime = new Date(metadata.startDate as string).getTime();
  } else if (metadata?.endDate || metadata?.endDateIso) {
    // Use end date as fallback
    const endDate = (metadata.endDateIso || metadata.endDate) as string;
    startTime = new Date(endDate).getTime();
  }
  
  // Detect status
  // NOTE: Polymarket uses closed, active, resolved flags
  let status: VendorEventStatus = 'PRE';
  
  const isClosed = metadata?.closed === true;
  const isResolved = metadata?.resolved === true;
  const isActive = metadata?.active === true;
  
  if (isResolved || isClosed) {
    status = 'ENDED';
  } else if (startTime) {
    const now = Date.now();
    const fourHoursMs = 4 * 60 * 60 * 1000;
    
    if (now >= startTime && now <= startTime + fourHoursMs) {
      status = 'LIVE';
    } else if (now > startTime + fourHoursMs) {
      status = 'ENDED';
    }
  }
  
  return {
    platform: 'POLYMARKET',
    vendorMarketId: conditionId, // NOTE: conditionId is the canonical market ID
    sport: sportResult.sport,
    league: category || undefined,
    homeTeam: home,
    awayTeam: away,
    teams,
    startTime,
    status,
    marketType: detectMarketType(title),
    rawTitle: title,
    extra: metadata,
    lastUpdatedAt: Date.now(),
    extractionConfidence: isSports ? 0.9 : sportResult.confidence,
  };
}

/**
 * Process Polymarket markets into the registry
 */
export function processPolymarketMarkets(markets: Market[]): number {
  let added = 0;
  
  for (const market of markets) {
    if (market.platform !== 'polymarket') continue;
    
    const metadata: Record<string, unknown> = {
      endDate: market.expiryDate,
    };
    
    const event = extractPolymarketEvent(market.id, market.title, metadata);
    
    if (event && event.teams.length >= 2) {
      addOrUpdateEvent(event);
      added++;
    }
  }
  
  return added;
}

// ============================================================================
// Kalshi Extractor
// ============================================================================
// NOTE: Field mapping follows Kalshi docs: https://docs.kalshi.com/

/** Kalshi sports-related ticker patterns */
const KALSHI_SPORTS_PATTERNS = [
  /^NBA/i,
  /^NFL/i,
  /^NHL/i,
  /^MLB/i,
  /^MLS/i,
  /^EPL/i,
  /^UCL/i,
  /^NCAA/i,
  /^CFP/i,
  /^SPORT/i,
];

/**
 * Extract VendorEvent from Kalshi market data
 *
 * Kalshi API fields (per docs):
 * - ticker: Unique market ticker (use as vendorMarketId)
 * - title: Market title/question
 * - event_ticker: Parent event ticker
 * - series_ticker: Series ticker
 * - status: Market status ("open", "closed", "settled")
 * - close_time: When trading closes (ISO 8601)
 * - open_time: When trading opened (ISO 8601)
 * - expiration_time: When market expires (ISO 8601)
 * - settlement_time: When market settles (ISO 8601)
 * - result: Settlement result ("yes", "no", null if unsettled)
 */
export function extractKalshiEvent(
  ticker: string,
  title: string,
  metadata?: Record<string, unknown>
): VendorEvent | null {
  // Check if ticker indicates sports
  const isSportsTicker = KALSHI_SPORTS_PATTERNS.some(p => p.test(ticker));
  
  // Also check event_ticker if available
  const eventTicker = metadata?.event_ticker as string | undefined;
  const isSportsEvent = eventTicker && KALSHI_SPORTS_PATTERNS.some(p => p.test(eventTicker));
  
  // Detect sport from ticker first, then title
  let sportResult = detectSport(ticker, metadata);
  if (sportResult.sport === 'OTHER') {
    sportResult = detectSport(title, metadata);
  }
  
  // Parse teams from title with sport context
  const { home, away, teams } = parseTeamsFromTitle(title, sportResult.sport);
  
  // Need sports ticker or good detection with teams
  if (!isSportsTicker && !isSportsEvent && sportResult.sport === 'OTHER') {
    return null;
  }
  
  // Parse start time
  // NOTE: Kalshi uses close_time as the primary time reference
  // For sports, the game typically happens around close_time
  let startTime: number | undefined;
  if (metadata?.close_time) {
    startTime = new Date(metadata.close_time as string).getTime();
  } else if (metadata?.expiration_time) {
    startTime = new Date(metadata.expiration_time as string).getTime();
  }
  
  // Extract league from event_ticker or series_ticker
  const league = eventTicker || (metadata?.series_ticker as string | undefined);
  
  // Detect status
  // NOTE: Kalshi status is "open", "closed", or "settled"
  let status: VendorEventStatus = 'PRE';
  
  const kalshiStatus = metadata?.status as string | undefined;
  const result = metadata?.result;
  
  if (kalshiStatus === 'settled' || result !== null && result !== undefined) {
    status = 'ENDED';
  } else if (kalshiStatus === 'closed') {
    status = 'ENDED';
  } else if (startTime) {
    const now = Date.now();
    const fourHoursMs = 4 * 60 * 60 * 1000;
    
    // For Kalshi, close_time is often during the game
    // Consider it LIVE if we're within 4 hours before close_time
    if (now >= startTime - fourHoursMs && now <= startTime) {
      status = 'LIVE';
    } else if (now > startTime) {
      status = 'ENDED';
    }
  }
  
  return {
    platform: 'KALSHI',
    vendorMarketId: ticker, // NOTE: ticker is the canonical market ID
    sport: sportResult.sport,
    league,
    homeTeam: home,
    awayTeam: away,
    teams,
    startTime,
    status,
    marketType: detectMarketType(title),
    rawTitle: title,
    extra: metadata,
    lastUpdatedAt: Date.now(),
    extractionConfidence: (isSportsTicker || isSportsEvent) ? 0.9 : sportResult.confidence,
  };
}

/**
 * Process Kalshi markets into the registry
 */
export function processKalshiMarkets(markets: Market[]): number {
  let added = 0;
  
  for (const market of markets) {
    if (market.platform !== 'kalshi') continue;
    
    const metadata: Record<string, unknown> = {
      close_time: market.expiryDate,
    };
    
    const event = extractKalshiEvent(market.ticker, market.title, metadata);
    
    if (event && event.teams.length >= 2) {
      addOrUpdateEvent(event);
      added++;
    }
  }
  
  return added;
}

// ============================================================================
// Unified Processing
// ============================================================================

/**
 * Process all markets from all platforms into the registry
 */
export function processAllMarkets(markets: Market[]): {
  sxbet: number;
  polymarket: number;
  kalshi: number;
  total: number;
} {
  const sxbet = processSxBetMarkets(markets.filter(m => m.platform === 'sxbet'));
  const polymarket = processPolymarketMarkets(markets.filter(m => m.platform === 'polymarket'));
  const kalshi = processKalshiMarkets(markets.filter(m => m.platform === 'kalshi'));
  
  return {
    sxbet,
    polymarket,
    kalshi,
    total: sxbet + polymarket + kalshi,
  };
}

// ============================================================================
// Live Update Handlers
// ============================================================================

/**
 * Handle a live price update from WebSocket
 * Can update event status based on live data
 */
export function handleLivePriceUpdate(
  platform: LiveEventPlatform,
  marketId: string,
  metadata?: Record<string, unknown>
): void {
  // If we receive live scores/game data, the event is in progress
  if (metadata?.gamePhase === 'live' || metadata?.inProgress === true) {
    // Could update the event status to LIVE
    // For now, periodic refresh handles this
  }
}

/**
 * Process raw SX.bet fixture data
 * Use this when you have direct access to SX.bet /fixtures response
 */
export function processSxBetFixture(fixture: {
  marketHash: string;
  title?: string;
  outcomeOneName?: string;
  outcomeTwoName?: string;
  gameTime?: number;
  sportLabel?: string;
  leagueLabel?: string;
  status?: number;
}): VendorEvent | null {
  const title = fixture.title || `${fixture.outcomeOneName} vs ${fixture.outcomeTwoName}`;
  
  return extractSxBetEvent(fixture.marketHash, title, {
    outcomeOneName: fixture.outcomeOneName,
    outcomeTwoName: fixture.outcomeTwoName,
    gameTime: fixture.gameTime,
    sportLabel: fixture.sportLabel,
    leagueLabel: fixture.leagueLabel,
    status: fixture.status,
  });
}

/**
 * Process raw Kalshi event data
 * Use this when you have direct access to Kalshi /events response
 */
export function processKalshiEventData(event: {
  ticker: string;
  title: string;
  event_ticker?: string;
  series_ticker?: string;
  status?: string;
  close_time?: string;
  expiration_time?: string;
  result?: string | null;
}): VendorEvent | null {
  return extractKalshiEvent(event.ticker, event.title, {
    event_ticker: event.event_ticker,
    series_ticker: event.series_ticker,
    status: event.status,
    close_time: event.close_time,
    expiration_time: event.expiration_time,
    result: event.result,
  });
}
