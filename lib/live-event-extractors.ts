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
 * LIVE DETECTION STRATEGY:
 * - Polymarket: gameStartTime <= now < gameStartTime + maxGameDuration
 * - Kalshi: Uses expected_expiration_time to estimate game window
 *   - estimated_start = expected_expiration - game_duration
 *   - LIVE if: (estimated_start - buffer) <= now <= (expected_end + buffer)
 *
 * @see docs/POLYMARKET_LIVE_SPORTS_DISCOVERY.md
 * @see docs/KALSHI_API_LIVE_SPORTS.md
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
import { normalizeEventTitle } from './text-normalizer';
import { addOrUpdateEvent, markEventEnded } from './live-event-registry';
import {
  recordClassification,
  recordVendorEventFiltered,
  recordVendorEventsFetched,
  recordKalshiFiltered,
  recordKalshiParsedEvent,
  recordKalshiDropReason,
  recordKalshiDroppedItem,
  recordKalshiEventClassification,
} from './live-events-debug';
import { getKalshiGameDurationHours } from '@/types/live-sports-discovery';

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
  
  // Normalize title for token-based matching
  const { normalizedTitle, tokens } = normalizeEventTitle(title, { sport: sportResult.sport });

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
    normalizedTitle,
    normalizedTokens: tokens,
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
  recordVendorEventsFetched('SXBET', markets.length);
  
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
    
    if (!event) {
      recordVendorEventFiltered('sxbet_not_sports_or_parse_failed');
      continue;
    }
    
    if (event.teams.length < 2) {
      recordVendorEventFiltered('sxbet_missing_teams');
      continue;
    }
    
    recordClassification(event.status);
    addOrUpdateEvent(event);
    added++;
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
  
  // Detect status using the improved LIVE detection logic
  // NOTE: Polymarket uses closed, active, resolved flags
  // 
  // LIVE DETECTION STRATEGY (from POLYMARKET_LIVE_SPORTS_DISCOVERY.md):
  // - gameStartTime <= now < gameStartTime + maxGameDuration
  // - With 15-minute tolerance for "about to start" games
  // - Default max game duration is 6 hours
  let status: VendorEventStatus = 'PRE';
  
  const isClosed = metadata?.closed === true;
  const isResolved = metadata?.resolved === true;
  const isActive = metadata?.active === true;
  
  if (isResolved || isClosed) {
    status = 'ENDED';
  } else if (startTime) {
    const now = Date.now();
    const maxGameDurationMs = 6 * 60 * 60 * 1000; // 6 hours
    const gameStartToleranceMs = 15 * 60 * 1000; // 15 minutes
    
    // Game is LIVE if:
    // - Start time is in the past (with 15-min tolerance for "about to start")
    // - Start time is within max game duration (game likely still in progress)
    const gameStarted = startTime <= now + gameStartToleranceMs;
    const gameNotEnded = startTime + maxGameDurationMs >= now;
    
    if (gameStarted && gameNotEnded) {
      status = 'LIVE';
    } else if (!gameNotEnded) {
      status = 'ENDED';
    }
  }
  
  // Normalize title for token-based matching
  const { normalizedTitle, tokens } = normalizeEventTitle(title, { sport: sportResult.sport });

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
    normalizedTitle,
    normalizedTokens: tokens,
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
  recordVendorEventsFetched('POLYMARKET', markets.length);
  
  for (const market of markets) {
    if (market.platform !== 'polymarket') continue;
    
    const metadata: Record<string, unknown> = {
      endDate: market.expiryDate,
    };
    
    const event = extractPolymarketEvent(market.id, market.title, metadata);
    
    if (!event) {
      recordVendorEventFiltered('polymarket_not_sports_or_low_confidence');
      continue;
    }
    
    if (event.teams.length < 2) {
      recordVendorEventFiltered('polymarket_missing_teams');
      continue;
    }
    
    recordClassification(event.status);
    addOrUpdateEvent(event);
    added++;
  }
  
  return added;
}

// ============================================================================
// Kalshi Extractor
// ============================================================================
// NOTE: Field mapping follows Kalshi docs: https://docs.kalshi.com/

/** Kalshi sports-related ticker patterns 
 * Phase 4: Made more inclusive to catch all sports series
 */
const KALSHI_SPORTS_PATTERNS = [
  // Game-specific patterns (highest priority)
  /^(KX)?NBAGAME/i,
  /^(KX)?NFLGAME/i,
  /^(KX)?NHLGAME/i,
  /^(KX)?MLBGAME/i,
  /^(KX)?EPLGAME/i,
  /^(KX)?UCLGAME/i,
  /GAME$/i,  // Any ticker ending with GAME
  // Player prop patterns
  /^(KX)?NBA3D/i,   // Triple doubles
  /^(KX)?NBAPTS/i,  // Points
  /^(KX)?NFLPTS/i,  // Points
  // Major US sports
  /^(KX)?NBA/i,
  /^(KX)?NFL/i,
  /^(KX)?NHL/i,
  /^(KX)?MLB/i,
  /^(KX)?MLS/i,
  /^(KX)?NCAA/i,
  /^(KX)?CFP/i,
  // European football leagues
  /^(KX)?EPL/i,
  /^(KX)?UCL/i,
  /^(KX)?LALIGA/i,
  /^(KX)?SERIEA/i,
  /^(KX)?BUNDESLIGA/i,
  /^(KX)?LIGUE1/i,
  /^(KX)?EREDIVISIE/i,
  // General sport patterns
  /^(KX)?SPORT/i,
  /^(KX)?UFC/i,
  /^(KX)?GOLF/i,
  /^(KX)?TENNIS/i,
  /^(KX)?BOXING/i,
  /^(KX)?F1/i,
  /^(KX)?NASCAR/i,
  // Match any ticker from Sports category (will be caught by series_ticker check)
  /MATCH$/i,
  /VS/i,
];

/**
 * Extract VendorEvent from Kalshi market data
 *
 * Kalshi API fields (per docs):
 * - ticker: Unique market ticker (use as vendorMarketId)
 * - title: Market title/question
 * - event_ticker: Parent event ticker
 * - series_ticker: Series ticker
 * - status: Market status ("active", "open", "closed", "settled", "finalized")
 * - close_time: When trading closes (ISO 8601)
 * - open_time: When trading opened (ISO 8601) - CRITICAL for LIVE detection
 * - expiration_time: When market expires (ISO 8601)
 * - settlement_time: When market settles (ISO 8601)
 * - result: Settlement result ("yes", "no", null if unsettled)
 *
 * LIVE Classification Logic:
 * - If open_time exists and open_time <= now < close_time AND status is tradable → LIVE
 * - If status is "settled", "finalized", or "closed" → ENDED
 * - Otherwise → PRE
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
  
  // Phase 4: Also check series_ticker for sports patterns
  const seriesTicker = metadata?.series_ticker as string | undefined;
  const isSportsSeries = seriesTicker && KALSHI_SPORTS_PATTERNS.some(p => p.test(seriesTicker));
  
  const sportHint = metadata?.sport_hint as string | undefined;
  const hasSportsHint = Boolean(sportHint);
  
  // Phase 4: Check if category is Sports
  const category = metadata?.category as string | undefined;
  const isSportsCategory = category?.toLowerCase() === 'sports';
  
  // Detect sport from ticker first, then title
  let sportResult = sportHint
    ? { sport: sportHint as Sport, confidence: 0.95 }
    : detectSport(ticker, metadata);
  if (sportResult.sport === 'OTHER') {
    sportResult = detectSport(title, metadata);
  }
  // Phase 4: Try detecting from series ticker if still OTHER
  if (sportResult.sport === 'OTHER' && seriesTicker) {
    const seriesSportResult = detectSport(seriesTicker, metadata);
    if (seriesSportResult.sport !== 'OTHER') {
      sportResult = seriesSportResult;
    }
  }
  
  // Parse teams from title with sport context
  const { home, away, teams } = parseTeamsFromTitle(title, sportResult.sport);
  
  // Phase 4: More lenient sports detection
  // Accept if ANY of these are true:
  // - ticker matches sports patterns
  // - event_ticker matches sports patterns
  // - series_ticker matches sports patterns
  // - has explicit sport hint
  // - category is Sports
  // - sport was detected from title
  const isSportsMarket = isSportsTicker || isSportsEvent || isSportsSeries || 
                         hasSportsHint || isSportsCategory || sportResult.sport !== 'OTHER';
  
  if (!isSportsMarket) {
    return null;
  }
  
  // Extract open_time (when trading/game starts) - critical for LIVE detection
  const openTimeRaw = metadata?.open_time as string | undefined;
  const openTimeMs = openTimeRaw ? new Date(openTimeRaw).getTime() : undefined;
  
  // Extract close_time (when trading ends)
  const closeTimeRaw = metadata?.close_time as string | undefined;
  const closeTimeMs = closeTimeRaw ? new Date(closeTimeRaw).getTime() : undefined;
  
  // Parse start time for the event (prefer open_time for sports games)
  // For game markets, open_time is when the game/market becomes active
  let startTime: number | undefined;
  if (openTimeMs && !isNaN(openTimeMs)) {
    startTime = openTimeMs;
  } else if (metadata?.expected_expiration_time) {
    startTime = new Date(metadata.expected_expiration_time as string).getTime();
  } else if (metadata?.event_start_time) {
    startTime = new Date(metadata.event_start_time as string).getTime();
  } else if (closeTimeMs) {
    startTime = closeTimeMs;
  } else if (metadata?.expiration_time) {
    startTime = new Date(metadata.expiration_time as string).getTime();
  }
  
  // Extract league from event_ticker or series_ticker
  const league =
    (metadata?.league as string | undefined) ||
    eventTicker ||
    (metadata?.series_ticker as string | undefined);
  
  // Detect status using the improved LIVE detection logic
  // NOTE: Kalshi status values are "active", "open", "closed", "settled", "finalized", "initialized"
  // 
  // LIVE DETECTION STRATEGY (from KALSHI_API_LIVE_SPORTS.md):
  // - Use expected_expiration_time as the key signal for when the game ENDS
  // - Estimate start time by subtracting sport-specific game duration
  // - Game is LIVE if: (estimated_start - buffer) <= now <= (expected_end + buffer)
  let status: VendorEventStatus = 'PRE';
  
  const kalshiStatus = (metadata?.status as string | undefined)?.toLowerCase();
  const result = metadata?.result;
  const now = Date.now();
  
  // Check for ended states first
  if (kalshiStatus === 'settled' || kalshiStatus === 'finalized' || kalshiStatus === 'closed') {
    status = 'ENDED';
  } else if (result !== null && result !== undefined) {
    status = 'ENDED';
  } else {
    // Market is tradable (active, open, or initialized)
    const isTradable = kalshiStatus === 'active' || kalshiStatus === 'open';
    
    // PRIMARY: Use expected_expiration_time for accurate LIVE detection
    const expectedExpirationStr = metadata?.expected_expiration_time as string | undefined;
    if (expectedExpirationStr && isTradable) {
      const expectedExpirationMs = new Date(expectedExpirationStr).getTime();
      if (!isNaN(expectedExpirationMs)) {
        // Get sport-specific game duration
        const seriesTickerForDuration = eventTicker || seriesTicker || '';
        const gameDurationHours = getKalshiGameDurationHours(seriesTickerForDuration);
        const gameDurationMs = gameDurationHours * 60 * 60 * 1000;
        const bufferMs = 1 * 60 * 60 * 1000; // 1 hour buffer
        
        // Calculate estimated start time
        const estimatedStartMs = expectedExpirationMs - gameDurationMs;
        
        // Game is LIVE if we're within the game window (with buffer)
        const startWindowMs = estimatedStartMs - bufferMs;
        const endWindowMs = expectedExpirationMs + bufferMs;
        
        if (now >= startWindowMs && now <= endWindowMs) {
          status = 'LIVE';
        } else if (now > endWindowMs) {
          status = 'ENDED';
        } else {
          status = 'PRE';
        }
      }
    }
    // FALLBACK: Use open_time and close_time if no expected_expiration_time
    else if (openTimeMs && closeTimeMs && isTradable) {
      if (openTimeMs <= now && now < closeTimeMs) {
        // Trading is open and we're between open_time and close_time
        status = 'LIVE';
      } else if (now >= closeTimeMs) {
        status = 'ENDED';
      } else {
        // now < openTimeMs - market hasn't opened yet
        status = 'PRE';
      }
    } 
    // LAST RESORT: Use startTime heuristic
    else if (isTradable && startTime) {
      const seriesTickerForDuration = eventTicker || seriesTicker || '';
      const gameDurationHours = getKalshiGameDurationHours(seriesTickerForDuration);
      const gameDurationMs = gameDurationHours * 60 * 60 * 1000;
      
      if (now >= startTime && now <= startTime + gameDurationMs) {
        status = 'LIVE';
      } else if (now > startTime + gameDurationMs) {
        status = 'ENDED';
      }
    }
  }
  
  // Normalize title for token-based matching
  const { normalizedTitle, tokens } = normalizeEventTitle(title, { sport: sportResult.sport });

  // Calculate extraction confidence based on how we detected sports
  let extractionConfidence = sportResult.confidence;
  if (isSportsTicker || isSportsEvent) {
    extractionConfidence = 0.95;
  } else if (isSportsSeries || hasSportsHint) {
    extractionConfidence = 0.9;
  } else if (isSportsCategory) {
    extractionConfidence = 0.85;
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
    normalizedTitle,
    normalizedTokens: tokens,
    extra: metadata,
    lastUpdatedAt: Date.now(),
    extractionConfidence,
  };
}

function isKalshiMultiEventTicker(eventTicker?: string): boolean {
  return !!(eventTicker && eventTicker.startsWith('KXMVE'));
}

function looksLikeKalshiSportsMarket(market: Market): boolean {
  if (market.platform !== 'kalshi') return false;
  // Check ticker, event_ticker, and series_ticker
  const vendorMeta = (market.vendorMetadata ?? {}) as Record<string, unknown>;
  const targets = [
    market.eventTicker,
    market.ticker,
    vendorMeta.kalshiSeriesTicker as string,
  ].filter(Boolean);
  
  return targets.some(target => 
    KALSHI_SPORTS_PATTERNS.some((pattern) => pattern.test(target!))
  );
}

/**
 * Build a Kalshi VendorEvent from a normalized Market object.
 */
export function createKalshiVendorEvent(market: Market): VendorEvent | null {
  if (market.platform !== 'kalshi') return null;

  const vendorMeta = (market.vendorMetadata ?? {}) as Record<string, unknown>;
  const kalshiEvent = vendorMeta.kalshiEvent as {
    event_ticker?: string;
    title?: string;
    sub_title?: string;
    category?: string;
    series_ticker?: string;
  } | undefined;
  const sportHint = vendorMeta.kalshiSportHint as string | undefined;
  const marketStatus = vendorMeta.kalshiMarketStatus as string | undefined;
  const kalshiOpenTime = vendorMeta.kalshiOpenTime as string | undefined;
  const seriesTicker =
    kalshiEvent?.series_ticker ||
    (vendorMeta.kalshiSeriesTicker as string | undefined) ||
    market.eventTicker;

  const eventTicker = kalshiEvent?.event_ticker || market.eventTicker || market.ticker;
  if (isKalshiMultiEventTicker(eventTicker)) {
    return null;
  }

  const titleSource = (kalshiEvent?.title || kalshiEvent?.sub_title || market.title).trim();

  const metadata: Record<string, unknown> = {
    close_time: market.expiryDate,
    open_time: kalshiOpenTime,  // Critical for LIVE classification
    expiration_time: market.expiryDate,
    expected_expiration_time: market.eventStartTime,
    event_ticker: eventTicker,
    series_ticker: seriesTicker,
    league: seriesTicker,
    category: kalshiEvent?.category,
    sport_hint: sportHint,
    status: marketStatus,
  };

  return extractKalshiEvent(market.ticker, titleSource, metadata);
}

/**
 * Process Kalshi markets into the registry
 * 
 * Phase 1: Enhanced debug visibility with detailed drop reasons
 * Phase 4: Relaxed extraction - don't require teams.length >= 2
 */
export function processKalshiMarkets(markets: Market[]): number {
  let added = 0;
  let combosSkipped = 0;
  let metadataMisses = 0;
  let noTeamsButAdded = 0; // Phase 4: Track events added without teams
  const sampleEvents: VendorEvent[] = [];
  
  recordVendorEventsFetched('KALSHI', markets.length);
  
  for (const market of markets) {
    if (market.platform !== 'kalshi') continue;
    const looksSports = looksLikeKalshiSportsMarket(market);
    const vendorMeta = (market.vendorMetadata ?? {}) as Record<string, unknown>;

    if (isKalshiMultiEventTicker(market.eventTicker)) {
      combosSkipped++;
      recordVendorEventFiltered('kalshi_multi_event_ticker');
      recordKalshiFiltered('multi_event_ticker');
      recordKalshiDropReason('multi_event_ticker');
      recordKalshiDroppedItem({
        ticker: market.ticker,
        title: market.title?.substring(0, 80),
        status: vendorMeta.kalshiMarketStatus as string,
        event_ticker: market.eventTicker,
        series_ticker: vendorMeta.kalshiSeriesTicker as string,
        close_time: market.expiryDate,
        open_time: vendorMeta.kalshiOpenTime as string,
        reason: 'multi_event_ticker',
      });
      continue;
    }

    const event = createKalshiVendorEvent(market);

    if (!event) {
      const reason = looksSports ? 'sports_ticker_parse_failed' : 'not_sports_ticker';
      if (looksSports) {
        metadataMisses++;
        recordVendorEventFiltered('kalshi_missing_metadata_or_parse_failed');
        recordKalshiFiltered('parse_failed');
      } else {
        recordKalshiFiltered('not_sports_ticker');
      }
      recordKalshiDropReason(reason);
      recordKalshiDroppedItem({
        ticker: market.ticker,
        title: market.title?.substring(0, 80),
        status: vendorMeta.kalshiMarketStatus as string,
        event_ticker: market.eventTicker,
        series_ticker: vendorMeta.kalshiSeriesTicker as string,
        close_time: market.expiryDate,
        open_time: vendorMeta.kalshiOpenTime as string,
        reason,
      });
      continue;
    }

    // Phase 4: Relaxed requirement - still add events without parsed teams
    // Log as warning but don't reject - matching can still work via event_ticker
    if (event.teams.length < 2) {
      noTeamsButAdded++;
      recordKalshiFiltered('missing_teams_warning');
      // Don't continue - still add the event
    }

    recordKalshiParsedEvent();
    recordClassification(event.status);
    recordKalshiEventClassification(event.status);
    addOrUpdateEvent(event);
    added++;
    if (sampleEvents.length < 5) {
      sampleEvents.push(event);
    }
  }

  console.info(
    '[Kalshi-Sports] Markets processed',
    {
      totalRaw: markets.length,
      sportsDetected: added,
      combosSkipped,
      metadataMisses,
      noTeamsButAdded,
      sample: sampleEvents.map((event) => ({
        sport: event.sport,
        matchup: `${event.awayTeam ?? '?'} @ ${event.homeTeam ?? '?'}`.trim(),
        startTime: event.startTime ? new Date(event.startTime).toISOString() : 'unknown',
        ticker: event.vendorMarketId,
        status: event.status,
        teamsCount: event.teams.length,
      })),
    }
  );
  
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
