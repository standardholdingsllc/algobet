/**
 * Polymarket LIVE Sports Markets Discovery Integration Test
 *
 * This test discovers currently-live sports markets on Polymarket using the
 * Gamma API, avoiding a full market crawl by using the event_date filter
 * and sports-specific fields.
 *
 * Approach:
 * 1. Query /sports to get sports configuration (sport codes, series IDs)
 * 2. Query /events with event_date=today to get today's sports events
 * 3. Filter to events with startTime <= now (game has started)
 * 4. Extract markets with sportsMarketType (confirmed sports markets)
 * 5. Output snapshot with debug info for tuning
 *
 * Run with: npm run test:poly-live
 *
 * Environment variables:
 *   POLY_GAMMA_URL - Optional override for Gamma API base URL
 *                    Default: https://gamma-api.polymarket.com
 *
 * You can set these via:
 *   1. Shell environment variables
 *   2. A .env.local file in the project root
 */

import { config } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  gammaGet,
  delay,
  getRequestCount,
  resetRequestCount,
  getBaseUrl,
  getRequestDelay,
  getTodayDateString,
  parseDate,
  GammaSport,
  GammaEvent,
  GammaMarket,
  SPORT_CODE_TO_NAME,
} from './utils/polymarketGamma';

// Load environment variables from .env.local if it exists
config({ path: path.join(process.cwd(), '.env.local') });
config({ path: path.join(process.cwd(), '.env') });

// ============================================================================
// CONFIGURATION - Tune these values as needed
// ============================================================================

/** Maximum pages to fetch for events (pagination) */
const MAX_PAGES = 5;

/** Events per page */
const EVENTS_PER_PAGE = 100;

/** Stop early if we've found this many live markets */
const EARLY_STOP_LIVE_MARKETS = 200;

/** 
 * How many hours after gameStartTime to consider a market potentially live.
 * Most games last 2-4 hours, so 6 hours is a safe upper bound.
 */
const MAX_GAME_DURATION_HOURS = 6;

/**
 * How many minutes in the future to allow for gameStartTime.
 * This accounts for games that are about to start or have minor timing discrepancies.
 */
const GAME_START_FUTURE_TOLERANCE_MINUTES = 15;

// ============================================================================
// GUARDRAILS - These assertions fail if exceeded
// ============================================================================

/** Maximum allowed API requests (2 dates * MAX_PAGES + sports query) */
const MAX_REQUESTS = 25;

/** Maximum allowed events fetched (2 dates worth) */
const MAX_EVENTS_FETCHED = 2000;

/** Maximum allowed markets inspected (2 dates worth) */
const MAX_MARKETS_INSPECTED = 10000;

/** Maximum allowed live markets in result */
const MAX_LIVE_MARKETS_FILTERED = 500;

// ============================================================================
// TYPES
// ============================================================================

interface SportInfo {
  code: string;
  name: string;
  seriesId?: string;
  tagIds: string[];
}

interface LiveMarketSnapshot {
  id: string;
  question: string;
  slug?: string;
  
  // Timing fields
  gameStartTime?: string | null;
  endDate?: string | null;
  
  // Sports-specific
  sportsMarketType?: string | null;
  
  // Status
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  
  // Parent event info
  parentEvent?: {
    id: string;
    title: string;
    startTime?: string;
    eventDate?: string;
  };
}

interface SnapshotOutput {
  generatedAt: string;
  config: {
    maxPages: number;
    eventsPerPage: number;
    earlyStopLiveMarkets: number;
    maxGameDurationHours: number;
    gameStartFutureToleranceMinutes: number;
    gammaBaseUrl: string;
  };
  sportsDiscovered: SportInfo[];
  counts: {
    requestsMade: number;
    pagesFetched: number;
    eventsFetched: number;
    eventsWithStartTimeInPast: number;
    marketsInspected: number;
    marketsWithSportsType: number;
    marketsLiveFiltered: number;
  };
  liveMarkets: LiveMarketSnapshot[];
  debug: {
    uniqueSportsMarketTypes: string[];
    eventsToday: number;
    first10Events: { title: string; startTime?: string; marketCount: number }[];
    first10RawMarkets: Partial<GammaMarket>[];
    nearMisses: { title: string; startTime?: string; reason: string }[];
  };
}

// ============================================================================
// CORE LIVE DETECTION LOGIC
// ============================================================================

/**
 * Determine if a market is currently LIVE based on Gamma fields.
 * 
 * A market is considered LIVE if:
 * 1. It has a sportsMarketType (confirmed sports market)
 * 2. It's not closed
 * 3. It's active
 * 4. gameStartTime exists and is in the past (game has started)
 * 5. gameStartTime is within MAX_GAME_DURATION_HOURS (game likely still in progress)
 * 
 * @param market - The Gamma market object
 * @param event - The parent event (provides startTime)
 * @param now - Current timestamp for comparison
 * @returns true if the market is considered LIVE
 */
export function isLiveSportsMarket(
  market: GammaMarket,
  event: GammaEvent | undefined,
  now: Date
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
  const toleranceMs = GAME_START_FUTURE_TOLERANCE_MINUTES * 60 * 1000;
  const maxDurationMs = MAX_GAME_DURATION_HOURS * 60 * 60 * 1000;

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
 * Extract trimmed market fields for debug output.
 */
function trimMarketForDebug(market: GammaMarket): Partial<GammaMarket> {
  return {
    id: market.id,
    question: market.question?.slice(0, 80),
    sportsMarketType: market.sportsMarketType,
    gameStartTime: market.gameStartTime,
    endDate: market.endDate,
    active: market.active,
    closed: market.closed,
    acceptingOrders: market.acceptingOrders,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Polymarket LIVE Sports Markets Discovery', () => {
  let snapshot: SnapshotOutput;

  beforeAll(() => {
    resetRequestCount();
  });

  afterAll(() => {
    console.log(`\n📊 Total Gamma API requests made: ${getRequestCount()}`);
  });

  it('should discover live sports markets without full market crawl', async () => {
    const now = new Date();
    const today = getTodayDateString();
    
    // Tracking
    const sportsDiscovered: SportInfo[] = [];
    let pagesFetched = 0;
    let eventsFetched = 0;
    let eventsWithStartTimeInPast = 0;
    let marketsInspected = 0;
    let marketsWithSportsType = 0;
    
    // Results
    const allEvents: GammaEvent[] = [];
    const liveMarkets: LiveMarketSnapshot[] = [];
    const uniqueSportsMarketTypes = new Set<string>();
    const nearMisses: { title: string; startTime?: string; reason: string }[] = [];

    // ========================================================================
    // STEP A: Discover sports configuration
    // ========================================================================
    
    console.log(`\n🔍 Discovering sports configuration from Gamma API...`);
    console.log(`   Base URL: ${getBaseUrl()}`);
    console.log(`   Current time: ${now.toISOString()}`);
    console.log(`   Today: ${today}`);
    
    try {
      const sportsData = await gammaGet<GammaSport[]>('/sports');
      console.log(`   ✅ /sports returned ${sportsData.length} sport configurations`);
      
      for (const sport of sportsData) {
        const tagIds = sport.tags ? sport.tags.split(',').map(t => t.trim()) : [];
        sportsDiscovered.push({
          code: sport.sport,
          name: SPORT_CODE_TO_NAME[sport.sport] || sport.sport.toUpperCase(),
          seriesId: sport.series,
          tagIds,
        });
      }
      
      // Show sample sports
      const sampleSports = sportsDiscovered.slice(0, 10).map(s => s.code).join(', ');
      console.log(`   📌 Sports: ${sampleSports}...`);
    } catch (error) {
      console.warn(`   ⚠️ /sports endpoint failed: ${error}`);
    }

    // ========================================================================
    // STEP B: Fetch events for today AND yesterday (UTC boundary handling)
    // Games that started late evening in US timezones will have yesterday's
    // event_date in UTC, but may still be live now.
    // ========================================================================
    
    // Get yesterday's date for UTC boundary handling
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const datesToQuery = [today, yesterday];
    
    console.log(`\n📡 Fetching events for today (${today}) and yesterday (${yesterday})...`);
    
    for (const eventDate of datesToQuery) {
      console.log(`\n   📅 Querying event_date=${eventDate}...`);
      
      for (let page = 0; page < MAX_PAGES; page++) {
        if (pagesFetched > 0) {
          await delay(getRequestDelay());
        }
        
        // Check early stop
        if (liveMarkets.length >= EARLY_STOP_LIVE_MARKETS) {
          console.log(`   ⏹️ Early stop: found ${liveMarkets.length} live markets`);
          break;
        }
        
        try {
          const eventsResponse = await gammaGet<GammaEvent[] | { events?: GammaEvent[]; data?: GammaEvent[] }>('/events', {
            event_date: eventDate,
            active: true,
            closed: false,
            limit: EVENTS_PER_PAGE,
            offset: page * EVENTS_PER_PAGE,
          });
          
          pagesFetched++;
          
          // Handle both array and object response formats
          const events: GammaEvent[] = Array.isArray(eventsResponse) 
            ? eventsResponse 
            : (eventsResponse.events || eventsResponse.data || []);
          
          if (events.length === 0) {
            console.log(`      Page ${page + 1}: 0 events (end of results)`);
            break;
          }
          
          eventsFetched += events.length;
          allEvents.push(...events);
          console.log(`      Page ${page + 1}: ${events.length} events`);
          
          // Process events
          for (const event of events) {
            const markets = event.markets || [];
            marketsInspected += markets.length;
            
            // Check if event has started
            const eventStarted = event.startTime ? 
              (parseDate(event.startTime)?.getTime() || Infinity) <= now.getTime() + GAME_START_FUTURE_TOLERANCE_MINUTES * 60 * 1000 : 
              false;
            
            if (eventStarted) {
              eventsWithStartTimeInPast++;
            }
            
            // Process markets
            for (const market of markets) {
              if (market.sportsMarketType) {
                marketsWithSportsType++;
                uniqueSportsMarketTypes.add(market.sportsMarketType);
              }
              
              // Check if this is a live sports market
              if (isLiveSportsMarket(market, event, now)) {
                liveMarkets.push({
                  id: market.id,
                  question: market.question,
                  slug: market.slug,
                  gameStartTime: market.gameStartTime,
                  endDate: market.endDate || market.endDateIso,
                  sportsMarketType: market.sportsMarketType,
                  active: market.active,
                  closed: market.closed,
                  acceptingOrders: market.acceptingOrders,
                  parentEvent: {
                    id: event.id,
                    title: event.title,
                    startTime: event.startTime,
                    eventDate: event.eventDate,
                  },
                });
              } else if (market.sportsMarketType && nearMisses.length < 10) {
                // Track near misses for debugging
                let reason = 'Unknown';
                const gameStart = parseDate(market.gameStartTime || event.startTime);
                if (!gameStart) {
                  reason = 'No start time';
                } else if (gameStart.getTime() > now.getTime() + GAME_START_FUTURE_TOLERANCE_MINUTES * 60 * 1000) {
                  reason = `Starts in future (${gameStart.toISOString()})`;
                } else if (gameStart.getTime() + MAX_GAME_DURATION_HOURS * 60 * 60 * 1000 < now.getTime()) {
                  reason = `Game likely ended (started ${gameStart.toISOString()})`;
                } else if (market.closed) {
                  reason = 'Market closed';
                } else if (market.active === false) {
                  reason = 'Market not active';
                }
                
                nearMisses.push({
                  title: market.question?.slice(0, 60) || event.title,
                  startTime: market.gameStartTime || event.startTime,
                  reason,
                });
              }
            }
          }
          
          // If fewer than limit, no more pages
          if (events.length < EVENTS_PER_PAGE) {
            break;
          }
          
        } catch (error) {
          console.warn(`      ⚠️ Error fetching page ${page + 1}: ${error}`);
          break;
        }
      }
      
      // Check early stop between dates
      if (liveMarkets.length >= EARLY_STOP_LIVE_MARKETS) {
        break;
      }
    }

    // ========================================================================
    // STEP C: Build and write snapshot
    // ========================================================================
    
    const requestsMade = getRequestCount();
    
    snapshot = {
      generatedAt: now.toISOString(),
      config: {
        maxPages: MAX_PAGES,
        eventsPerPage: EVENTS_PER_PAGE,
        earlyStopLiveMarkets: EARLY_STOP_LIVE_MARKETS,
        maxGameDurationHours: MAX_GAME_DURATION_HOURS,
        gameStartFutureToleranceMinutes: GAME_START_FUTURE_TOLERANCE_MINUTES,
        gammaBaseUrl: getBaseUrl(),
      },
      sportsDiscovered,
      counts: {
        requestsMade,
        pagesFetched,
        eventsFetched,
        eventsWithStartTimeInPast,
        marketsInspected,
        marketsWithSportsType,
        marketsLiveFiltered: liveMarkets.length,
      },
      liveMarkets,
      debug: {
        uniqueSportsMarketTypes: Array.from(uniqueSportsMarketTypes),
        eventsToday: allEvents.length,
        first10Events: allEvents.slice(0, 10).map(e => ({
          title: e.title,
          startTime: e.startTime,
          marketCount: (e.markets || []).length,
        })),
        first10RawMarkets: allEvents.slice(0, 3).flatMap(e => 
          (e.markets || []).slice(0, 3).map(trimMarketForDebug)
        ),
        nearMisses,
      },
    };

    // Write snapshot to file
    const snapshotPath = path.join(process.cwd(), 'data', 'polymarket-live-snapshot.json');
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    console.log(`\n💾 Snapshot written to: ${snapshotPath}`);

    // ========================================================================
    // STEP D: Assertions / Guardrails
    // ========================================================================
    
    console.log('\n🔒 Running guardrail assertions...');
    
    const printDebugInfo = () => {
      console.log('\n=== DEBUG INFO ===');
      console.log('Counts:', JSON.stringify(snapshot.counts, null, 2));
      console.log('\nFirst 10 live markets:');
      liveMarkets.slice(0, 10).forEach((m, i) => {
        console.log(`  ${i + 1}. [${m.sportsMarketType}] ${m.question?.slice(0, 60)}`);
        console.log(`     gameStart: ${m.gameStartTime}, event: ${m.parentEvent?.title?.slice(0, 40)}`);
      });
      console.log('\nNear misses (sports markets not live):');
      nearMisses.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.title}`);
        console.log(`     startTime: ${m.startTime}, reason: ${m.reason}`);
      });
      console.log('\nUnique sportsMarketType values:', Array.from(uniqueSportsMarketTypes));
      console.log('==================\n');
    };

    try {
      // 1. Request count guardrail
      expect(
        requestsMade,
        `Requests made (${requestsMade}) exceeds max (${MAX_REQUESTS})`
      ).toBeLessThanOrEqual(MAX_REQUESTS);

      // 2. Events fetched guardrail
      expect(
        eventsFetched,
        `Events fetched (${eventsFetched}) exceeds max (${MAX_EVENTS_FETCHED})`
      ).toBeLessThanOrEqual(MAX_EVENTS_FETCHED);

      // 3. Markets inspected guardrail
      expect(
        marketsInspected,
        `Markets inspected (${marketsInspected}) exceeds max (${MAX_MARKETS_INSPECTED})`
      ).toBeLessThanOrEqual(MAX_MARKETS_INSPECTED);

      // 4. Live markets guardrail
      expect(
        liveMarkets.length,
        `Live markets (${liveMarkets.length}) exceeds max (${MAX_LIVE_MARKETS_FILTERED})`
      ).toBeLessThanOrEqual(MAX_LIVE_MARKETS_FILTERED);

      // 5. Every returned live market has sportsMarketType
      for (const lm of liveMarkets) {
        expect(
          lm.sportsMarketType,
          `Market ${lm.id} should have sportsMarketType`
        ).toBeTruthy();
      }

      // 6. No returned market is closed
      for (const lm of liveMarkets) {
        expect(
          lm.closed,
          `Market ${lm.id} should not be closed`
        ).not.toBe(true);
      }

      // 7. If gameStartTime exists, assert it's <= now + tolerance
      const toleranceMs = GAME_START_FUTURE_TOLERANCE_MINUTES * 60 * 1000;
      for (const lm of liveMarkets) {
        if (lm.gameStartTime) {
          const gameStart = parseDate(lm.gameStartTime);
          if (gameStart) {
            expect(
              gameStart.getTime(),
              `Market ${lm.id} gameStartTime (${lm.gameStartTime}) should be <= now + ${GAME_START_FUTURE_TOLERANCE_MINUTES}min`
            ).toBeLessThanOrEqual(now.getTime() + toleranceMs);
          }
        }
      }

      // 8. If gameStartTime exists, assert it's not too old (game likely ended)
      const maxDurationMs = MAX_GAME_DURATION_HOURS * 60 * 60 * 1000;
      for (const lm of liveMarkets) {
        if (lm.gameStartTime) {
          const gameStart = parseDate(lm.gameStartTime);
          if (gameStart) {
            expect(
              gameStart.getTime() + maxDurationMs,
              `Market ${lm.id} game should not have ended (started ${lm.gameStartTime})`
            ).toBeGreaterThanOrEqual(now.getTime());
          }
        }
      }

    } catch (error) {
      printDebugInfo();
      throw error;
    }

    // ========================================================================
    // Summary
    // ========================================================================
    
    console.log('\n✅ All assertions passed!');
    console.log(`\n📊 Summary:`);
    console.log(`   Sports discovered: ${sportsDiscovered.length}`);
    console.log(`   Pages fetched: ${pagesFetched}`);
    console.log(`   Events fetched: ${eventsFetched}`);
    console.log(`   Events with startTime in past: ${eventsWithStartTimeInPast}`);
    console.log(`   Markets inspected: ${marketsInspected}`);
    console.log(`   Markets with sportsMarketType: ${marketsWithSportsType}`);
    console.log(`   LIVE markets found: ${liveMarkets.length}`);
    console.log(`   Requests made: ${requestsMade}`);
    console.log(`   sportsMarketTypes: ${Array.from(uniqueSportsMarketTypes).join(', ')}`);
    
    if (liveMarkets.length > 0) {
      console.log(`\n🔴 Sample LIVE markets:`);
      liveMarkets.slice(0, 5).forEach((m, i) => {
        console.log(`   ${i + 1}. [${m.sportsMarketType}] ${m.question?.slice(0, 60)}...`);
        console.log(`      gameStart: ${m.gameStartTime}`);
      });
    } else {
      console.log(`\n⚠️ No LIVE sports markets found at this time.`);
      console.log(`   This is expected if no games are currently in progress.`);
      console.log(`   Events today: ${eventsFetched}`);
      console.log(`   Events with startTime in past: ${eventsWithStartTimeInPast}`);
      
      if (nearMisses.length > 0) {
        console.log(`\n   Near misses (why markets aren't live):`);
        nearMisses.slice(0, 5).forEach((m, i) => {
          console.log(`   ${i + 1}. ${m.title}`);
          console.log(`      Reason: ${m.reason}`);
        });
      }
    }

  }, 120000); // 120 second timeout for API calls
});
