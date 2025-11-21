/**
 * Hot Market Tracker
 * 
 * Tracks markets that exist on multiple platforms and should be monitored intensively.
 * Live events create the most market dislocation, so once we find the same event on
 * multiple bookies, we track it and constantly check all platform combinations for arbs.
 */

import { Market, TrackedMarket, TrackedPlatformMarket } from '../types';
import { normalizeForMatching } from './market-matching';

export class HotMarketTracker {
  private trackedMarkets: Map<string, TrackedMarket>;
  private idCounter: number;

  constructor() {
    this.trackedMarkets = new Map();
    this.idCounter = 1;
  }

  /**
   * Add or update markets in the tracking system
   * Groups markets by normalized title across platforms
   */
  addMarkets(markets: Market[]): { newlyTracked: number; updated: number } {
    // Group markets by normalized title
    const marketGroups = new Map<string, Market[]>();
    let newlyTracked = 0;
    let updated = 0;
    
    for (const market of markets) {
      const normalized = normalizeForMatching(market.title);
      
      if (!marketGroups.has(normalized)) {
        marketGroups.set(normalized, []);
      }
      marketGroups.get(normalized)!.push(market);
    }

    // Add to tracking if market exists on 2+ platforms
    for (const [normalizedTitle, groupMarkets] of marketGroups.entries()) {
      // Get unique platforms
      const platforms = new Set(groupMarkets.map(m => m.platform));
      
      // Only track if on 2+ platforms (potential for arbitrage)
      if (platforms.size >= 2) {
        const result = this.addOrUpdateTrackedMarket(normalizedTitle, groupMarkets);
        if (result === 'new') {
          newlyTracked += 1;
        } else if (result === 'updated') {
          updated += 1;
        }
      }
    }

    return { newlyTracked, updated };
  }

  /**
   * Add or update a tracked market
   */
  private addOrUpdateTrackedMarket(
    normalizedTitle: string,
    markets: Market[]
  ): 'new' | 'updated' {
    const existing = this.trackedMarkets.get(normalizedTitle);
    const now = new Date();

    if (existing) {
      // Update existing tracked market
      existing.platforms = markets.map(m => ({
        platform: m.platform,
        marketId: m.id,
        market: m,
        lastUpdated: now,
      }));
      existing.lastChecked = now;
      existing.expiryDate = new Date(markets[0].expiryDate);
      return 'updated';
    } else {
      // Create new tracked market
      const trackedMarket: TrackedMarket = {
        id: `tracked-${this.idCounter++}`,
        normalizedTitle,
        displayTitle: markets[0].title, // Use first market's title for display
        platforms: markets.map(m => ({
          platform: m.platform,
          marketId: m.id,
          market: m,
          lastUpdated: now,
        })),
        firstDetected: now,
        expiryDate: new Date(markets[0].expiryDate),
        lastChecked: now,
        opportunitiesFound: 0,
        isLive: this.isLiveEvent(markets[0]),
      };

      this.trackedMarkets.set(normalizedTitle, trackedMarket);
      console.log(`🎯 TRACKING NEW MARKET: ${trackedMarket.displayTitle} (on ${trackedMarket.platforms.length} platforms)`);
      return 'new';
    }
    return 'updated';
  }

  /**
   * Get all possible platform combinations for a tracked market
   * For a market on [Kalshi, Polymarket, SXbet], returns:
   * [Kalshi-Polymarket, Kalshi-SXbet, Polymarket-SXbet]
   */
  getAllCombinations(trackedMarket: TrackedMarket): [Market, Market][] {
    const combinations: [Market, Market][] = [];
    const markets = trackedMarket.platforms.map(p => p.market);

    // Generate all unique pairs
    for (let i = 0; i < markets.length; i++) {
      for (let j = i + 1; j < markets.length; j++) {
        combinations.push([markets[i], markets[j]]);
      }
    }

    return combinations;
  }

  /**
   * Get all tracked markets
   */
  getAllTrackedMarkets(): TrackedMarket[] {
    return Array.from(this.trackedMarkets.values());
  }

  /**
   * Get tracked markets that are live events
   */
  getLiveTrackedMarkets(): TrackedMarket[] {
    return this.getAllTrackedMarkets().filter(m => m.isLive);
  }

  /**
   * Get count of tracked markets
   */
  getTrackedCount(): number {
    return this.trackedMarkets.size;
  }

  /**
   * Get count of live tracked markets
   */
  getLiveTrackedCount(): number {
    return this.getLiveTrackedMarkets().length;
  }

  /**
   * Remove expired markets from tracking
   */
  removeExpired(): number {
    const now = new Date();
    let removedCount = 0;

    for (const [key, market] of this.trackedMarkets.entries()) {
      if (new Date(market.expiryDate) <= now) {
        console.log(`✅ Market expired, removing from tracking: ${market.displayTitle}`);
        this.trackedMarkets.delete(key);
        removedCount++;
      }
    }

    return removedCount;
  }

  /**
   * Increment opportunity count for a market
   */
  recordOpportunity(normalizedTitle: string): void {
    const market = this.trackedMarkets.get(normalizedTitle);
    if (market) {
      market.opportunitiesFound++;
    }
  }

  /**
   * Check if a market is a live event based on expiry and type
   */
  private isLiveEvent(market: Market): boolean {
    const now = new Date();
    const expiryTime = new Date(market.expiryDate);
    const hoursUntilExpiry = (expiryTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Live event criteria:
    // 1. Sportsbook market expiring within 3 hours
    // 2. Any market expiring within 1 hour
    if (market.marketType === 'sportsbook' && hoursUntilExpiry <= 3 && hoursUntilExpiry > 0) {
      return true;
    }

    if (hoursUntilExpiry <= 1 && hoursUntilExpiry > 0) {
      return true;
    }

    return false;
  }

  /**
   * Get summary stats for logging/dashboard
   */
  getStats(): {
    totalTracked: number;
    liveTracked: number;
    totalPlatformCombinations: number;
    topMarkets: { title: string; platforms: number; opportunities: number }[];
  } {
    const allMarkets = this.getAllTrackedMarkets();
    const totalCombinations = allMarkets.reduce(
      (sum, market) => sum + this.getAllCombinations(market).length,
      0
    );

    // Top 5 markets by opportunity count
    const topMarkets = allMarkets
      .sort((a, b) => b.opportunitiesFound - a.opportunitiesFound)
      .slice(0, 5)
      .map(m => ({
        title: m.displayTitle,
        platforms: m.platforms.length,
        opportunities: m.opportunitiesFound,
      }));

    return {
      totalTracked: this.getTrackedCount(),
      liveTracked: this.getLiveTrackedCount(),
      totalPlatformCombinations: totalCombinations,
      topMarkets,
    };
  }

  /**
   * Clear all tracked markets (useful for testing/restart)
   */
  clear(): void {
    this.trackedMarkets.clear();
  }
}

