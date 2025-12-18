/**
 * Live Market Fetcher
 * 
 * Simple module for fetching live markets directly from platform APIs.
 * Used by the live-arb worker to populate the event registry.
 * 
 * Supports live-only filtering via the liveOnly flag from LiveArbRuntimeConfig.
 */

import { Market, MarketPlatform, BotConfig, MarketFilterInput } from '@/types';
import { LiveArbRuntimeConfig } from '@/types/live-arb';
import {
  KalshiAPI,
  DEFAULT_KALSHI_ALLOW_FALLBACK_ALL_MARKETS,
  DEFAULT_KALSHI_CLOSE_WINDOW_MINUTES,
  DEFAULT_KALSHI_SPORTS_SERIES_TICKER,
} from './markets/kalshi';
import { PolymarketAPI } from './markets/polymarket';
import { SXBetAPI } from './markets/sxbet';

const DAY_MS = 86_400_000;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export interface FetchResult {
  platform: MarketPlatform;
  markets: Market[];
  fetchedAt: string;
  error?: string;
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
    
    try {
      let markets: Market[] = [];
      
      switch (platform) {
        case 'kalshi':
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
    const windowEnd = filters.windowEnd ? new Date(filters.windowEnd) : undefined;
    const now = Date.now();
    const windowMinutesFromFilter = windowEnd
      ? Math.max(1, Math.ceil((windowEnd.getTime() - now) / 60000))
      : DEFAULT_KALSHI_CLOSE_WINDOW_MINUTES;

    const maxCloseMinutes = Math.min(windowMinutesFromFilter, DEFAULT_KALSHI_CLOSE_WINDOW_MINUTES);
    const sportsOnly = filters.sportsOnly ?? true;

    return this.kalshiApi.getOpenMarkets({
      maxCloseMinutes,
      minCloseMinutes: 120, // include markets that just went live
      status: 'open',
      seriesTicker: sportsOnly ? DEFAULT_KALSHI_SPORTS_SERIES_TICKER : undefined,
      sportsOnly,
      allowFallbackAllMarkets: DEFAULT_KALSHI_ALLOW_FALLBACK_ALL_MARKETS,
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
}

