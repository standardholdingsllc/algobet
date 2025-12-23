/**
 * Live Market Fetcher
 * 
 * Module for fetching live markets directly from platform APIs.
 * Used by the live-arb worker to populate the event registry.
 * 
 * Supports two modes:
 * 1. Standard mode: Fetches all markets and filters client-side
 * 2. Live Discovery mode: Uses targeted API queries to find in-play games
 *    - Polymarket: event_date filter for today's sports events
 *    - Kalshi: series_ticker filter for known sports game series
 * 
 * @see docs/POLYMARKET_LIVE_SPORTS_DISCOVERY.md
 * @see docs/KALSHI_API_LIVE_SPORTS.md
 */

import { Market, MarketPlatform, BotConfig, MarketFilterInput } from '@/types';
import { LiveArbRuntimeConfig } from '@/types/live-arb';
import { VendorEvent } from '@/types/live-events';
import {
  KalshiAPI,
  DEFAULT_KALSHI_CLOSE_WINDOW_MINUTES,
  DEFAULT_KALSHI_MIN_CLOSE_WINDOW_MINUTES,
  DEFAULT_KALSHI_MAX_PAGES_PER_SERIES,
  DEFAULT_KALSHI_MAX_TOTAL_MARKETS,
} from './markets/kalshi';
import { PolymarketAPI } from './markets/polymarket';
import { SXBetAPI } from './markets/sxbet';
import {
  recordPlatformFetchAttempt,
  recordPlatformFetchError,
  recordPlatformFetchSkipped,
} from './live-events-debug';
import {
  discoverAllLiveSports,
  discoveryResultsToVendorEvents,
  filterToLiveMarkets,
  hasKalshiCredentials as checkKalshiCredentials,
} from './live-sports-discovery';
import { CombinedLiveSportsResult } from '@/types/live-sports-discovery';

const DAY_MS = 86_400_000;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export interface FetchResult {
  platform: MarketPlatform;
  markets: Market[];
  fetchedAt: string;
  error?: string;
}

/**
 * Result from live sports discovery
 */
export interface LiveSportsDiscoveryFetchResult {
  vendorEvents: VendorEvent[];
  discoveryResult: CombinedLiveSportsResult;
  fetchedAt: string;
}

export class LiveMarketFetcher {
  private kalshiApi = new KalshiAPI();
  private polymarketApi = new PolymarketAPI();
  private sxbetApi = new SXBetAPI();

  /**
   * Build filter parameters from BotConfig and optional LiveArbRuntimeConfig.
   * The liveOnly flag is derived from runtimeConfig.liveEventsOnly.
   */
  buildFiltersFromConfig(
    botConfig: BotConfig,
    runtimeConfig?: LiveArbRuntimeConfig
  ): MarketFilterInput {
    const now = new Date();
    const maxDate = new Date(now.getTime() + botConfig.maxDaysToExpiry * DAY_MS);
    const preferences = botConfig.marketFilters || {};
    
    // Derive liveOnly from runtime config if provided
    const liveOnly = runtimeConfig?.liveEventsOnly ?? false;
    const sportsOnly = runtimeConfig?.sportsOnly ?? preferences.sportsOnly ?? false;
    
    return {
      windowStart: now.toISOString(),
      windowEnd: maxDate.toISOString(),
      sportsOnly,
      liveOnly,
      categories: preferences.categories?.filter(Boolean),
      eventTypes: preferences.eventTypes?.filter(Boolean),
      leagueTickers: preferences.leagueTickers?.filter(Boolean),
      maxMarkets: preferences.maxMarkets,
    };
  }

  /**
   * Fetch live markets from all platforms
   */
  async fetchAllPlatforms(
    filters: MarketFilterInput
  ): Promise<Record<MarketPlatform, FetchResult>> {
    const platforms: MarketPlatform[] = ['kalshi', 'polymarket', 'sxbet'];
    const results = await Promise.all(
      platforms.map((platform) => this.fetchPlatform(platform, filters))
    );
    
    return {
      kalshi: results[0],
      polymarket: results[1],
      sxbet: results[2],
    };
  }

  /**
   * Fetch live markets from a single platform
   */
  async fetchPlatform(
    platform: MarketPlatform,
    filters: MarketFilterInput
  ): Promise<FetchResult> {
    const fetchedAt = new Date().toISOString();

    recordPlatformFetchAttempt(platform);

    try {
      let markets: Market[] = [];
      
      switch (platform) {
        case 'kalshi':
          if (!this.hasKalshiCredentials()) {
            recordPlatformFetchSkipped('kalshi', 'missing_kalshi_credentials');
            return {
              platform,
              markets: [],
              fetchedAt,
              error: 'missing_kalshi_credentials',
            };
          }
          markets = await this.fetchKalshiMarkets(filters);
          break;
        case 'polymarket':
          markets = await this.fetchPolymarketMarkets(filters);
          break;
        case 'sxbet':
          markets = await this.fetchSxbetMarkets(filters);
          break;
      }
      
      // Apply live-only filter if enabled
      if (filters.liveOnly) {
        markets = this.filterToLiveEvents(markets, platform);
      }
      
      // Apply sports-only filter if enabled
      if (filters.sportsOnly) {
        markets = this.filterToSportsEvents(markets);
      }
      
      return { platform, markets, fetchedAt };
    } catch (error: any) {
      console.error(`[LiveMarketFetcher] Failed to fetch ${platform}:`, error.message);
      recordPlatformFetchError(platform, error.message || 'unknown_error');
      recordPlatformFetchSkipped(platform, 'exception');
      return { 
        platform, 
        markets: [], 
        fetchedAt,
        error: error.message 
      };
    }
  }

  /**
   * Filter markets to only include live/in-play events.
   * Uses time-based heuristics and market type signals.
   */
  private filterToLiveEvents(markets: Market[], platform: MarketPlatform): Market[] {
    const now = Date.now();
    
    return markets.filter((market) => {
      const expiryMs = new Date(market.expiryDate).getTime();
      const timeToExpiry = expiryMs - now;
      
      // Already expired - not live
      if (timeToExpiry < 0) return false;
      
      // For sportsbook markets (primarily SX.bet), consider "live" if:
      // - Expiring within 3 hours (likely in-progress game)
      if (market.marketType === 'sportsbook') {
        return timeToExpiry <= THREE_HOURS_MS;
      }
      
      // For prediction markets (Kalshi, Polymarket), consider "live" if:
      // - Expiring within 3 hours
      // - This is a heuristic; true live status would require platform-specific flags
      return timeToExpiry <= THREE_HOURS_MS;
    });
  }

  /**
   * Filter markets to only include sports-related events.
   * Uses market type and title pattern matching.
   */
  private filterToSportsEvents(markets: Market[]): Market[] {
    return markets.filter((market) => {
      // Sportsbook markets are definitionally sports
      if (market.marketType === 'sportsbook') return true;
      
      // Use title patterns for prediction markets
      const title = market.title.toLowerCase();
      return (
        /\b(vs|@|versus)\b/.test(title) ||
        /\b(nba|nfl|mlb|nhl|mls|ncaa|premier league|la liga|serie a|bundesliga)\b/.test(title) ||
        /\b(game|match|bout|fight|race)\b/.test(title)
      );
    });
  }

  private async fetchKalshiMarkets(filters: MarketFilterInput): Promise<Market[]> {
    const sportsOnly = filters.sportsOnly ?? true;

    // For sports markets, skip close window filtering because:
    // 1. Kalshi game markets (KXNBAGAME, KXNFLGAME, etc.) have close_time weeks in the future
    // 2. The API doesn't allow status=open with min/max_close_ts parameters
    // 3. We use open_time for LIVE classification instead
    //
    // This fetches all active/open sports markets and relies on client-side
    // open_time-based filtering to determine which are LIVE.
    const skipCloseWindowFilter = sportsOnly;

    if (skipCloseWindowFilter) {
      return this.kalshiApi.getOpenMarkets({
        status: 'open',
        sportsOnly,
        skipCloseWindowFilter: true,
        maxPagesPerSeries: DEFAULT_KALSHI_MAX_PAGES_PER_SERIES,
        maxTotalMarkets: DEFAULT_KALSHI_MAX_TOTAL_MARKETS,
      });
    }

    // For non-sports markets, use the original close window filtering
    const windowEnd = filters.windowEnd ? new Date(filters.windowEnd) : undefined;
    const now = Date.now();
    const windowMinutesFromFilter = windowEnd
      ? Math.max(1, Math.ceil((windowEnd.getTime() - now) / 60000))
      : DEFAULT_KALSHI_CLOSE_WINDOW_MINUTES;

    const maxCloseMinutes = Math.min(windowMinutesFromFilter, DEFAULT_KALSHI_CLOSE_WINDOW_MINUTES);

    return this.kalshiApi.getOpenMarkets({
      maxCloseMinutes,
      minCloseMinutes: DEFAULT_KALSHI_MIN_CLOSE_WINDOW_MINUTES,
      status: 'open',
      sportsOnly: false,
      skipCloseWindowFilter: false,
      maxPagesPerSeries: DEFAULT_KALSHI_MAX_PAGES_PER_SERIES,
      maxTotalMarkets: DEFAULT_KALSHI_MAX_TOTAL_MARKETS,
    });
  }

  private async fetchPolymarketMarkets(filters: MarketFilterInput): Promise<Market[]> {
    const windowEnd = filters.windowEnd ? new Date(filters.windowEnd) : undefined;
    const maxDays = windowEnd 
      ? Math.ceil((windowEnd.getTime() - Date.now()) / DAY_MS)
      : 10;
    
    return this.polymarketApi.getOpenMarkets(maxDays);
  }

  private async fetchSxbetMarkets(filters: MarketFilterInput): Promise<Market[]> {
    const windowEnd = filters.windowEnd ? new Date(filters.windowEnd) : undefined;
    const maxDays = windowEnd 
      ? Math.ceil((windowEnd.getTime() - Date.now()) / DAY_MS)
      : 10;
    
    return this.sxbetApi.getOpenMarkets(maxDays);
  }

  // ============================================================================
  // Live Sports Discovery Mode
  // ============================================================================

  /**
   * Use targeted live sports discovery instead of fetching all markets.
   * 
   * This mode uses efficient API queries to find in-play games:
   * - Polymarket: Uses event_date filter for today's sports events
   * - Kalshi: Uses series_ticker filter for known sports game series
   * 
   * This is more efficient than fetching all markets when you only need
   * currently-live sports events.
   * 
   * @returns VendorEvents ready for registry population
   */
  async discoverLiveSports(): Promise<LiveSportsDiscoveryFetchResult> {
    console.log('[LiveMarketFetcher] Starting live sports discovery...');
    
    try {
      const discoveryResult = await discoverAllLiveSports();
      const vendorEvents = discoveryResultsToVendorEvents(discoveryResult);
      
      console.log(
        `[LiveMarketFetcher] Discovery complete: ` +
        `${vendorEvents.length} vendor events ` +
        `(Polymarket: ${discoveryResult.polymarket.counts.liveMarketsFound}, ` +
        `Kalshi: ${discoveryResult.kalshi.counts.liveMarketsFound})`
      );
      
      return {
        vendorEvents,
        discoveryResult,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('[LiveMarketFetcher] Live sports discovery failed:', error.message);
      return {
        vendorEvents: [],
        discoveryResult: {
          polymarket: {
            platform: 'polymarket',
            discoveredAt: new Date().toISOString(),
            liveMarkets: [],
            counts: {
              requestsMade: 0,
              eventsFetched: 0,
              eventsWithStartTimeInPast: 0,
              marketsInspected: 0,
              liveMarketsFound: 0,
            },
          },
          kalshi: {
            platform: 'kalshi',
            discoveredAt: new Date().toISOString(),
            liveMarkets: [],
            counts: {
              requestsMade: 0,
              eventsFetched: 0,
              eventsWithStartTimeInPast: 0,
              marketsInspected: 0,
              liveMarketsFound: 0,
            },
          },
          totalLiveMarkets: 0,
          discoveredAt: new Date().toISOString(),
        },
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Fetch all platforms and apply live sports filtering using the discovery logic.
   * 
   * This combines the standard market fetching with the live detection heuristics
   * from the discovery module.
   */
  async fetchAllPlatformsWithLiveFilter(
    filters: MarketFilterInput
  ): Promise<Record<MarketPlatform, FetchResult>> {
    const results = await this.fetchAllPlatforms(filters);
    
    // Apply live sports filtering to each platform's results
    for (const platform of Object.keys(results) as MarketPlatform[]) {
      const result = results[platform];
      if (result.markets.length > 0 && filters.liveOnly) {
        result.markets = filterToLiveMarkets(result.markets);
      }
    }
    
    return results;
  }

  /**
   * Check if Kalshi credentials are available
   */
  hasKalshiCredentials(): boolean {
    return checkKalshiCredentials();
  }
}

