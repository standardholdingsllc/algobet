/**
 * Live Market Fetcher
 * 
 * Simple module for fetching live markets directly from platform APIs.
 * Used by the live-arb worker to populate the event registry.
 */

import { Market, MarketPlatform, BotConfig, MarketFilterInput } from '@/types';
import { KalshiAPI } from './markets/kalshi';
import { PolymarketAPI } from './markets/polymarket';
import { SXBetAPI } from './markets/sxbet';

const DAY_MS = 86_400_000;

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
   * Build filter parameters from BotConfig
   */
  buildFiltersFromConfig(config: BotConfig): MarketFilterInput {
    const now = new Date();
    const maxDate = new Date(now.getTime() + config.maxDaysToExpiry * DAY_MS);
    const preferences = config.marketFilters || {};
    return {
      windowStart: now.toISOString(),
      windowEnd: maxDate.toISOString(),
      sportsOnly: preferences.sportsOnly,
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

  private async fetchKalshiMarkets(filters: MarketFilterInput): Promise<Market[]> {
    const windowEnd = filters.windowEnd ? new Date(filters.windowEnd) : undefined;
    const maxDays = windowEnd 
      ? Math.ceil((windowEnd.getTime() - Date.now()) / DAY_MS)
      : 10;
    
    return this.kalshiApi.getOpenMarkets(maxDays);
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

