/**
 * Kalshi LIVE Markets Discovery Integration Test
 *
 * This test discovers currently-live sports markets on Kalshi using the
 * Events endpoint with series_ticker filters, avoiding a full 30k+ market crawl.
 *
 * Approach:
 * 1. Query /events for each known sports game series (KXNFLGAME, KXNBAGAME, etc.)
 * 2. Filter events to those with status=open and strike_date in the past (game started)
 * 3. Collect markets from those events
 * 4. Apply final filtering for tradable markets
 *
 * Run with: npm run test:kalshi-live
 *
 * Environment variables required:
 *   KALSHI_API_KEY - Your Kalshi API key
 *   KALSHI_PRIVATE_KEY - Your Kalshi RSA private key (PEM format)
 *
 * You can set these via:
 *   1. Shell environment variables
 *   2. A .env.local file in the project root
 */

import { config } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env.local if it exists
config({ path: path.join(process.cwd(), '.env.local') });
config({ path: path.join(process.cwd(), '.env') });

// ============================================================================
// CONFIGURATION - Tune these values to match UI "LIVE" list scale
// ============================================================================

/** Base URL for Kalshi API */
const KALSHI_BASE_URL = process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2';

/** Known sports game series tickers - these are the actual game winner markets */
const SPORTS_GAME_SERIES = [
  // === MAJOR US SPORTS ===
  'KXNFLGAME',      // NFL game winners
  'KXNBAGAME',      // NBA game winners  
  'KXNHLGAME',      // NHL game winners
  'KXMLBGAME',      // MLB game winners
  'KXWNBAGAME',     // WNBA game winners
  'KXMLSGAME',      // MLS game winners
  
  // === COLLEGE SPORTS ===
  'KXNCAAFGAME',    // College football (FBS) game winners
  'KXNCAABGAME',    // College basketball (Men's) game winners
  'KXNCAAWGAME',    // College basketball (Women's) game winners
  'KXCFBGAME',      // College football (alternate ticker)
  'KXCBBGAME',      // College basketball (alternate ticker)
  
  // === SOCCER / FOOTBALL ===
  'KXSOCCER',       // Soccer matches (generic)
  'KXEPLGAME',      // English Premier League
  'KXUCLGAME',      // UEFA Champions League
  'KXLALIGAGAME',   // La Liga (Spain)
  'KXBUNDESLIGAGAME', // Bundesliga (Germany)
  'KXSABORAGAME',   // Serie A (Italy)
  'KXLIGUE1GAME',   // Ligue 1 (France)
  'KXLIGAMXGAME',   // Liga MX (Mexico)
  'KXWORLDCUP',     // FIFA World Cup
  'KXEUROGAME',     // UEFA Euro
  
  // === COMBAT SPORTS ===
  'KXUFCFIGHT',     // UFC fights
  'KXUFC',          // UFC (alternate)
  'KXBOXING',       // Boxing matches
  'KXBOX',          // Boxing (alternate)
  'KXMMAFIGHT',     // MMA fights (generic)
  'KXPFL',          // PFL fights
  'KXBELLATOR',     // Bellator fights
  
  // === INDIVIDUAL SPORTS ===
  'KXTENNIS',       // Tennis matches
  'KXTENNISGAME',   // Tennis (alternate)
  'KXGOLF',         // Golf tournaments
  'KXPGATOUR',      // PGA Tour
  'KXF1RACE',       // Formula 1 races
  'KXNASCAR',       // NASCAR races
  'KXINDYCAR',      // IndyCar races
  
  // === OTHER SPORTS ===
  'KXRUGBY',        // Rugby matches
  'KXCRICKET',      // Cricket matches
  'KXESPORTS',      // Esports matches
  'KXLOLGAME',      // League of Legends
  'KXCSGOGAME',     // CS:GO matches
  'KXDOTA2GAME',    // Dota 2 matches
];

/** Maximum events to fetch per series */
const EVENTS_LIMIT = 100;

/** Maximum markets to fetch per request */
const MARKETS_LIMIT = 1000;

/** Delay between API requests (ms) to avoid rate limiting */
const REQUEST_DELAY_MS = 150;

/** 
 * Typical game durations by sport (in hours).
 * Used to estimate if a game has started based on expected_expiration_time.
 */
const GAME_DURATION_HOURS: Record<string, number> = {
  'KXNFLGAME': 4,      // NFL games ~3-4 hours
  'KXNCAAFGAME': 4,    // College football ~3-4 hours
  'KXNBAGAME': 3,      // NBA games ~2.5-3 hours
  'KXNCAABGAME': 2.5,  // College basketball ~2-2.5 hours
  'KXNHLGAME': 3,      // NHL games ~2.5-3 hours
  'KXMLBGAME': 3.5,    // MLB games ~3-3.5 hours
  'KXEPLGAME': 2,      // Soccer ~2 hours
  'KXLALIGAGAME': 2,
  'KXBUNDESLIGAGAME': 2,
  'KXUCLGAME': 2,
  'KXBOXING': 4,       // Boxing events ~3-4 hours
  'KXUFCFIGHT': 4,     // UFC events ~3-4 hours
  'DEFAULT': 3,        // Default 3 hours
};

/** Buffer time (hours) to add before expected game end to account for delays */
const LIVE_BUFFER_HOURS = 1;

// ============================================================================
// GUARDRAILS - These assertions fail if exceeded
// ============================================================================

/** Maximum allowed live markets in result */
const MAX_LIVE_MARKETS = 300;

/** Maximum allowed event tickers collected */
const MAX_EVENT_TICKERS = 200;

// ============================================================================
// SPORTS DETECTION HEURISTICS
// ============================================================================

/** Title patterns that indicate a live game (matchups) */
const MATCHUP_TITLE_PATTERNS = [
  /\s+vs\.?\s+/i,  // "Team A vs Team B" or "Team A vs. Team B"
  /\s+at\s+/i,     // "Team A at Team B"
  /\s+@\s+/,       // "Team A @ Team B"
];

// ============================================================================
// TYPES
// ============================================================================

interface KalshiEvent {
  event_ticker: string;
  title: string;
  sub_title?: string;
  category?: string;
  series_ticker?: string;
  status?: string;
  strike_date?: string;    // When the game/event occurs
  open_time?: string;      // When trading opened
  close_time?: string;
  markets?: KalshiMarket[];
}

interface KalshiEventsResponse {
  events: KalshiEvent[];
  cursor?: string;
}

interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  close_time: string;
  open_time?: string;
  status: string;
  category?: string;
  series_ticker?: string;
  yes_price?: number;
  no_price?: number;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  volume?: number;
  volume_24h?: number;
}

interface KalshiMarketsResponse {
  markets: KalshiMarket[];
  cursor?: string;
}

interface SnapshotEvent {
  event_ticker: string;
  title: string;
  series_ticker?: string;
  status?: string;
  strike_date?: string;
  close_time?: string;
  market_count: number;
}

interface SnapshotMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  close_time: string;
  status: string;
  series_ticker?: string;
  yes_price?: number;
  no_price?: number;
}

interface LiveSnapshot {
  generatedAt: string;
  config: {
    sportsGameSeries: string[];
    eventsLimit: number;
    lookbackHours?: number;
    futureHoursMarket?: number;
    gameDurationHours?: Record<string, number>;
    liveBufferHours?: number;
    maxLiveMarkets: number;
    maxEventTickers: number;
  };
  counts: {
    seriesQueried: number;
    totalEventsFound: number;
    liveEvents: number;
    eventTickers: number;
    marketsRequestsMade: number;
    totalMarketsFetched: number;
    liveMarketsFiltered: number;
  };
  liveEvents: SnapshotEvent[];
  markets: SnapshotMarket[];
  marketTickers: string[];
  /** Debug: series that returned events */
  seriesWithEvents?: Record<string, number>;
}

// ============================================================================
// KALSHI HTTP CLIENT WITH AUTH
// ============================================================================

let kalshiPrivateKeyFormatted: string | null = null;
let requestCount = 0;

function formatPrivateKey(key: string): string {
  if (!key) return '';

  let formattedKey = key.trim();

  // Handle escaped newlines
  if (formattedKey.includes('\\n')) {
    formattedKey = formattedKey.replace(/\\n/g, '\n');
  }

  // Handle single-line format
  if (formattedKey.includes('-----BEGIN') && !formattedKey.includes('\n')) {
    formattedKey = formattedKey
      .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, (match) => `${match}\n`)
      .replace(/-----END (RSA )?PRIVATE KEY-----/, (match) => `\n${match}`)
      .replace(/\s+/g, '\n');
  }

  // Add headers if missing
  if (!formattedKey.includes('-----BEGIN')) {
    formattedKey = `-----BEGIN RSA PRIVATE KEY-----\n${formattedKey}\n-----END RSA PRIVATE KEY-----`;
  }

  // Convert RSA to PKCS#8 if needed
  if (formattedKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    try {
      const keyObject = crypto.createPrivateKey({
        key: formattedKey,
        format: 'pem',
        type: 'pkcs1',
      });
      formattedKey = keyObject.export({
        type: 'pkcs8',
        format: 'pem',
      }) as string;
    } catch {
      // Keep RSA format if conversion fails
    }
  }

  return formattedKey;
}

function getPrivateKey(): string {
  if (kalshiPrivateKeyFormatted) return kalshiPrivateKeyFormatted;
  kalshiPrivateKeyFormatted = formatPrivateKey(process.env.KALSHI_PRIVATE_KEY || '');
  return kalshiPrivateKeyFormatted;
}

function signRequest(timestamp: string, method: string, apiPath: string, body?: string): string {
  const privateKey = getPrivateKey();
  const message = `${timestamp}${method}${apiPath}${body || ''}`;

  const signature = crypto.sign('sha256', Buffer.from(message), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });

  return signature.toString('base64');
}

async function kalshiHttp<T>(
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const apiKey = process.env.KALSHI_API_KEY?.trim();
  const privateKey = getPrivateKey();

  if (!apiKey || !privateKey) {
    throw new Error(
      'Missing Kalshi credentials. Set KALSHI_API_KEY and KALSHI_PRIVATE_KEY environment variables.'
    );
  }

  // Build URL with query params
  const url = new URL(`${KALSHI_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, String(value));
  });

  // The path for signing must include query string
  const signaturePath = `/trade-api/v2${endpoint}${url.search ? url.search : ''}`;
  const timestamp = Date.now().toString();
  const signature = signRequest(timestamp, 'GET', signaturePath);

  const headers: Record<string, string> = {
    'KALSHI-ACCESS-KEY': apiKey,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
  };

  requestCount++;

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Kalshi HTTP ${response.status}: ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Helper to delay between requests */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the expected game duration for a series.
 */
function getGameDurationHours(seriesTicker: string): number {
  return GAME_DURATION_HOURS[seriesTicker] || GAME_DURATION_HOURS['DEFAULT'];
}

/**
 * Check if an event is TRULY LIVE based on expected_expiration_time.
 * 
 * Logic:
 * - expected_expiration_time = when the game is expected to END
 * - Game is LIVE if: (expected_end - game_duration) <= now < expected_end
 * - With buffer: (expected_end - game_duration - buffer) <= now < (expected_end + buffer)
 */
function isLiveEvent(event: KalshiEvent, now: Date): boolean {
  // Check nested markets for status and timing
  if (!event.markets || event.markets.length === 0) {
    return false;
  }

  const market = event.markets[0] as any;
  
  // Market must be open/active
  const marketStatus = market.status?.toLowerCase();
  if (marketStatus !== 'open' && marketStatus !== 'active') {
    return false;
  }

  // Use expected_expiration_time as the key signal
  const expectedExpirationStr = market.expected_expiration_time;
  if (!expectedExpirationStr) {
    // Fallback: no expected_expiration_time, can't determine live status
    return false;
  }

  const expectedExpiration = new Date(expectedExpirationStr);
  if (isNaN(expectedExpiration.getTime())) {
    return false;
  }

  // Get typical game duration for this sport
  const seriesTicker = event.series_ticker || '';
  const gameDurationHours = getGameDurationHours(seriesTicker);
  const gameDurationMs = gameDurationHours * 60 * 60 * 1000;
  const bufferMs = LIVE_BUFFER_HOURS * 60 * 60 * 1000;

  // Calculate estimated game start time
  const estimatedStartTime = new Date(expectedExpiration.getTime() - gameDurationMs);
  
  // Game is LIVE if:
  // - We're past the estimated start time (with buffer for early starts)
  // - We're before the expected end time (with buffer for overtime)
  const nowMs = now.getTime();
  const startWindowMs = estimatedStartTime.getTime() - bufferMs;
  const endWindowMs = expectedExpiration.getTime() + bufferMs;

  return nowMs >= startWindowMs && nowMs <= endWindowMs;
}

/**
 * Check if a market is tradable.
 * Note: We don't filter by close_time since Kalshi game markets close weeks after the game.
 */
function isLiveMarket(market: KalshiMarket, _now: Date): boolean {
  // Must be open or active (Kalshi uses "active" for tradable markets)
  const status = market.status?.toLowerCase();
  if (status !== 'open' && status !== 'active') {
    return false;
  }

  // Market is tradable - close_time is not relevant for "live" determination
  // since Kalshi game markets stay open for weeks after the game for settlement
  return true;
}

function printDebugInfo(
  events: KalshiEvent[],
  markets: KalshiMarket[],
  counts: LiveSnapshot['counts']
): void {
  console.log('\n=== DEBUG INFO ===');
  console.log('Counts:', JSON.stringify(counts, null, 2));

  console.log('\nFirst 10 event titles:');
  events.slice(0, 10).forEach((e, i) => {
    console.log(`  ${i + 1}. [${e.series_ticker}] ${e.title} (status: ${e.status}, strike: ${e.strike_date})`);
  });

  console.log('\nFirst 10 market titles:');
  markets.slice(0, 10).forEach((m, i) => {
    console.log(`  ${i + 1}. [${m.status}] ${m.title} (closes: ${m.close_time})`);
  });
  console.log('==================\n');
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Kalshi LIVE Markets Discovery', () => {
  let snapshot: LiveSnapshot;

  beforeAll(() => {
    requestCount = 0;
  });

  afterAll(() => {
    console.log(`\n📊 Total Kalshi API requests made: ${requestCount}`);
  });

  it('should discover live sports markets without full market crawl', async () => {
    const now = new Date();

    console.log(`\n🔍 Querying ${SPORTS_GAME_SERIES.length} sports game series...`);

    // Step 1: Query events for each sports game series
    const allEvents: KalshiEvent[] = [];
    const seriesWithEvents: Record<string, number> = {};
    let seriesQueried = 0;

    for (const seriesTicker of SPORTS_GAME_SERIES) {
      seriesQueried++;
      
      if (seriesQueried > 1) {
        await delay(REQUEST_DELAY_MS);
      }

      try {
        const eventsResponse = await kalshiHttp<KalshiEventsResponse>('/events', {
          series_ticker: seriesTicker,
          status: 'open',
          limit: EVENTS_LIMIT,
          with_nested_markets: 'true',
        });

        const events = eventsResponse.events || [];
        if (events.length > 0) {
          seriesWithEvents[seriesTicker] = events.length;
          allEvents.push(...events);
          console.log(`  ✅ ${seriesTicker}: ${events.length} events`);
        }
      } catch (error) {
        // Series might not exist or have no events - that's OK
        if (!String(error).includes('404')) {
          console.warn(`  ⚠️ ${seriesTicker}: ${error}`);
        }
        if (String(error).includes('429')) {
          await delay(2000);
        }
      }
    }

    console.log(`\n📌 Found ${allEvents.length} total events across ${Object.keys(seriesWithEvents).length} series`);

    // Debug: Show live detection logic for sample events
    if (allEvents.length > 0) {
      console.log(`\n🔍 LIVE DETECTION ANALYSIS (now: ${now.toISOString()}):`);
      
      // Show a few events with their live status calculation
      const sampleEvents = allEvents.slice(0, 8);
      sampleEvents.forEach((e, i) => {
        const m = e.markets?.[0] as any;
        if (!m) return;
        
        const expectedExp = m.expected_expiration_time ? new Date(m.expected_expiration_time) : null;
        const seriesTicker = e.series_ticker || '';
        const gameDuration = getGameDurationHours(seriesTicker);
        const estimatedStart = expectedExp ? new Date(expectedExp.getTime() - gameDuration * 60 * 60 * 1000) : null;
        const isLive = isLiveEvent(e, now);
        
        console.log(`  ${i + 1}. ${e.title} [${isLive ? '🔴 LIVE' : '⚪ NOT LIVE'}]`);
        console.log(`     ticker: ${e.event_ticker}`);
        console.log(`     status: ${m.status}`);
        console.log(`     expected_end: ${m.expected_expiration_time || 'N/A'}`);
        console.log(`     estimated_start: ${estimatedStart?.toISOString() || 'N/A'} (${gameDuration}h game)`);
      });
    }

    // Step 2: Filter to live events (game has started)
    const liveEvents = allEvents.filter((e) => isLiveEvent(e, now));
    console.log(`\n🔴 ${liveEvents.length} events are LIVE (game in progress)`);

    // Step 3: Collect markets from live events
    const allMarkets: KalshiMarket[] = [];
    const eventTickersSet = new Set<string>();
    let marketsRequestsMade = 0;

    // First, collect markets from nested events (if available)
    for (const event of liveEvents) {
      eventTickersSet.add(event.event_ticker);
      if (event.markets && event.markets.length > 0) {
        allMarkets.push(...event.markets);
      }
    }

    // If we didn't get nested markets, fetch them separately
    if (allMarkets.length === 0 && liveEvents.length > 0) {
      console.log(`📡 Fetching markets for ${liveEvents.length} live events...`);
      
      for (const event of liveEvents) {
        marketsRequestsMade++;
        
        if (marketsRequestsMade > 1) {
          await delay(REQUEST_DELAY_MS);
        }

        try {
          const marketsResponse = await kalshiHttp<KalshiMarketsResponse>('/markets', {
            event_ticker: event.event_ticker,
            status: 'open',
            limit: MARKETS_LIMIT,
          });
          allMarkets.push(...(marketsResponse.markets || []));
        } catch (error) {
          console.warn(`  ⚠️ Failed to fetch markets for ${event.event_ticker}: ${error}`);
          if (String(error).includes('429')) {
            await delay(2000);
          }
        }
      }
    }

    console.log(`📈 Collected ${allMarkets.length} markets from ${eventTickersSet.size} events`);

    // Step 4: Filter to live/tradable markets
    const liveMarkets = allMarkets.filter((m) => isLiveMarket(m, now));
    console.log(`✅ ${liveMarkets.length} markets pass live filter`);

    // Build snapshot
    const eventTickers = Array.from(eventTickersSet);
    const counts: LiveSnapshot['counts'] = {
      seriesQueried,
      totalEventsFound: allEvents.length,
      liveEvents: liveEvents.length,
      eventTickers: eventTickers.length,
      marketsRequestsMade,
      totalMarketsFetched: allMarkets.length,
      liveMarketsFiltered: liveMarkets.length,
    };

    snapshot = {
      generatedAt: now.toISOString(),
      config: {
        sportsGameSeries: SPORTS_GAME_SERIES,
        eventsLimit: EVENTS_LIMIT,
        gameDurationHours: GAME_DURATION_HOURS,
        liveBufferHours: LIVE_BUFFER_HOURS,
        maxLiveMarkets: MAX_LIVE_MARKETS,
        maxEventTickers: MAX_EVENT_TICKERS,
      },
      counts,
      liveEvents: liveEvents.map((e) => ({
        event_ticker: e.event_ticker,
        title: e.title,
        series_ticker: e.series_ticker,
        status: e.status,
        strike_date: e.strike_date,
        close_time: e.close_time,
        market_count: e.markets?.length || 0,
      })),
      markets: liveMarkets.map((m) => ({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        title: m.title,
        status: m.status,
        series_ticker: m.series_ticker,
        expected_expiration_time: (m as any).expected_expiration_time,
        close_time: m.close_time,
        yes_price: m.yes_price,
        no_price: m.no_price,
      })),
      marketTickers: liveMarkets.map((m) => m.ticker),
      seriesWithEvents,
    };

    // Write snapshot to file
    const snapshotPath = path.join(process.cwd(), 'data', 'kalshi-live-snapshot.json');
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    console.log(`\n💾 Snapshot written to: ${snapshotPath}`);

    // ========================================================================
    // ASSERTIONS / GUARDRAILS
    // ========================================================================

    const runAssertions = () => {
      // 1. Live markets count guardrail
      if (liveMarkets.length > MAX_LIVE_MARKETS) {
        printDebugInfo(liveEvents, liveMarkets, counts);
      }
      expect(
        liveMarkets.length,
        `Live markets (${liveMarkets.length}) exceeds max (${MAX_LIVE_MARKETS})`
      ).toBeLessThanOrEqual(MAX_LIVE_MARKETS);

      // 2. Event tickers count guardrail
      if (eventTickers.length > MAX_EVENT_TICKERS) {
        printDebugInfo(liveEvents, liveMarkets, counts);
      }
      expect(
        eventTickers.length,
        `Event tickers (${eventTickers.length}) exceeds max (${MAX_EVENT_TICKERS})`
      ).toBeLessThanOrEqual(MAX_EVENT_TICKERS);

      // 3. Prove we're not doing a full crawl - requests should be bounded
      const maxExpectedRequests = SPORTS_GAME_SERIES.length + liveEvents.length + 5;
      expect(
        requestCount,
        `Total requests (${requestCount}) exceeds expected max (${maxExpectedRequests})`
      ).toBeLessThanOrEqual(maxExpectedRequests);

      // 4. Every returned market has status=open or status=active
      for (const market of liveMarkets) {
        const validStatuses = ['open', 'active'];
        expect(
          validStatuses.includes(market.status?.toLowerCase()),
          `Market ${market.ticker} has invalid status=${market.status}`
        ).toBe(true);
      }
    };

    try {
      runAssertions();
    } catch (error) {
      printDebugInfo(liveEvents, liveMarkets, counts);
      throw error;
    }

    // Summary
    console.log('\n✅ All assertions passed!');
    console.log(`\n📊 Summary:`);
    console.log(`   Series queried: ${counts.seriesQueried}`);
    console.log(`   Total events found: ${counts.totalEventsFound}`);
    console.log(`   Live events: ${counts.liveEvents}`);
    console.log(`   Event tickers: ${counts.eventTickers}`);
    console.log(`   Markets fetched: ${counts.totalMarketsFetched}`);
    console.log(`   Live markets (final): ${counts.liveMarketsFiltered}`);
  }, 120000); // 120 second timeout for API calls
});

