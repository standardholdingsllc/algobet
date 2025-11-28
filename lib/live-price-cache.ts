/**
 * Live Price Cache
 *
 * In-memory cache for real-time price data from WebSocket feeds.
 * Designed to be read by the bot/scanner while being updated by WS clients.
 *
 * Key design decisions:
 * - Single global instance (singleton pattern matching existing lib/ modules)
 * - Thread-safe for Node.js single-threaded event loop
 * - Automatic staleness detection
 * - Separate storage for scores (SX.bet only)
 *
 * ============================================================================
 * MULTI-PROCESS / SCALING BEHAVIOR
 * ============================================================================
 *
 * IMPORTANT: This cache is IN-MEMORY and PER-PROCESS.
 *
 * Implications:
 * - If the app runs multiple workers/containers/instances, each has its own
 *   independent cache and WebSocket connections.
 * - Price data is NOT shared between processes.
 * - Each process maintains its own WebSocket connections and receives its
 *   own stream of price updates.
 *
 * Recommended deployment patterns:
 *
 * 1. SINGLE LIVE-ARB WORKER (Recommended for simplicity)
 *    - Run a dedicated process for live arbitrage with LIVE_ARB_WORKER=true
 *    - This process handles all WS connections and live arb detection
 *    - The cron bot continues to use snapshot-based arbitrage
 *    - Set up: npm run live-arb-worker (or similar script)
 *
 * 2. DISTRIBUTED CACHING (Future enhancement)
 *    - Would require Redis/Upstash for shared price state
 *    - WebSocket updates would publish to Redis pub/sub
 *    - Multiple workers would subscribe to Redis for price updates
 *    - Not implemented yet - only needed at scale
 *
 * 3. STICKY SESSIONS / SINGLE REPLICA
 *    - Deploy with a single replica for the live-arb service
 *    - Use horizontal scaling only for the REST API / dashboard
 *    - Live arbitrage runs in one process only
 *
 * Environment variables:
 * - LIVE_ARB_WORKER: Set to "true" to designate this process as the
 *   dedicated live arb worker. When false/unset, live arb features
 *   are available but should only be used in single-process deployments.
 * - LIVE_ARB_ENABLED: Master switch to enable/disable live arb features.
 *
 * For now, the assumption is single-process deployment or a dedicated
 * live-arb worker process alongside the snapshot/cron-based bot.
 * ============================================================================
 */

import {
  LiveMarketKey,
  LivePriceEntry,
  LivePriceUpdate,
  LiveScoreEntry,
  LiveScoreUpdate,
  LivePriceHandler,
  LiveScoreHandler,
  serializeLiveMarketKey,
  parseLiveMarketKey,
} from '@/types/live-arb';
import { MarketPlatform, Market } from '@/types';

// ============================================================================
// Price Conversion Utilities
// ============================================================================

/**
 * Convert platform-specific price to implied probability (0-1)
 */
export function priceToImpliedProbability(
  platform: MarketPlatform,
  price: number,
  outcomeId: string
): number {
  if (platform === 'sxbet') {
    // SX.bet uses decimal odds (e.g., 2.0 = 50% implied)
    // Implied probability = 1 / decimal odds
    return price > 0 ? 1 / price : 0;
  } else {
    // Kalshi and Polymarket use cents (0-100)
    // YES price in cents = implied probability * 100
    // For NO, we need to flip: NO price = 100 - YES price
    if (outcomeId === 'no') {
      return (100 - price) / 100;
    }
    return price / 100;
  }
}

/**
 * Convert implied probability to platform-specific price
 */
export function impliedProbabilityToPrice(
  platform: MarketPlatform,
  impliedProb: number,
  outcomeId: string
): number {
  if (platform === 'sxbet') {
    // Decimal odds = 1 / implied probability
    return impliedProb > 0 ? 1 / impliedProb : 100;
  } else {
    // Cents = implied probability * 100
    if (outcomeId === 'no') {
      return 100 - impliedProb * 100;
    }
    return impliedProb * 100;
  }
}

// ============================================================================
// Live Price Cache Implementation
// ============================================================================

class LivePriceCacheImpl {
  /** Map of serialized key -> price entry */
  private priceCache: Map<string, LivePriceEntry> = new Map();

  /** Map of fixtureId -> score entry (SX.bet only) */
  private scoreCache: Map<string, LiveScoreEntry> = new Map();

  /** Subscribers for price updates */
  private priceHandlers: Set<LivePriceHandler> = new Set();

  /** Subscribers for score updates */
  private scoreHandlers: Set<LiveScoreHandler> = new Set();

  /** Statistics for monitoring */
  private stats: {
    totalPriceUpdates: number;
    totalScoreUpdates: number;
    priceUpdatesByPlatform: Record<MarketPlatform, number>;
  } = {
    totalPriceUpdates: 0,
    totalScoreUpdates: 0,
    priceUpdatesByPlatform: {
      kalshi: 0,
      polymarket: 0,
      sxbet: 0,
    },
  };

  // --------------------------------------------------------------------------
  // Price Cache Operations
  // --------------------------------------------------------------------------

  /**
   * Update a live price in the cache.
   * Called by WebSocket handlers when they receive price updates.
   */
  updateLivePrice(update: LivePriceUpdate): void {
    const keyStr = serializeLiveMarketKey(update.key);

    // Calculate implied probability if not provided
    const impliedProbability =
      update.impliedProbability ??
      priceToImpliedProbability(
        update.key.platform,
        update.price,
        update.key.outcomeId
      );

    const entry: LivePriceEntry = {
      key: update.key,
      price: update.price,
      impliedProbability,
      lastUpdatedAt: new Date().toISOString(),
      source: update.source,
      meta: update.meta,
    };

    this.priceCache.set(keyStr, entry);

    // Update stats
    this.stats.totalPriceUpdates++;
    this.stats.priceUpdatesByPlatform[update.key.platform] =
      (this.stats.priceUpdatesByPlatform[update.key.platform] ?? 0) + 1;

    // Notify subscribers
    for (const handler of this.priceHandlers) {
      try {
        handler(update);
      } catch (err) {
        console.error('[LivePriceCache] Error in price handler:', err);
      }
    }
  }

  /**
   * Get a live price from the cache.
   * Returns undefined if the price is not cached.
   */
  getLivePrice(key: LiveMarketKey): LivePriceEntry | undefined {
    const keyStr = serializeLiveMarketKey(key);
    const entry = this.priceCache.get(keyStr);
    if (!entry) return undefined;

    // Compute age at read time
    const ageMs = Date.now() - new Date(entry.lastUpdatedAt).getTime();
    return { ...entry, ageMs };
  }

  /**
   * Get a live price by serialized key string.
   */
  getLivePriceByKey(keyStr: string): LivePriceEntry | undefined {
    const key = parseLiveMarketKey(keyStr);
    if (!key) return undefined;
    return this.getLivePrice(key);
  }

  /**
   * Get all prices for a specific market (both YES and NO outcomes)
   */
  getMarketPrices(
    platform: MarketPlatform,
    marketId: string
  ): { yes?: LivePriceEntry; no?: LivePriceEntry } {
    const yesKey: LiveMarketKey = { platform, marketId, outcomeId: 'yes' };
    const noKey: LiveMarketKey = { platform, marketId, outcomeId: 'no' };
    return {
      yes: this.getLivePrice(yesKey),
      no: this.getLivePrice(noKey),
    };
  }

  /**
   * Get all cached prices for a platform
   */
  getPricesForPlatform(platform: MarketPlatform): LivePriceEntry[] {
    const entries: LivePriceEntry[] = [];
    const now = Date.now();

    for (const entry of this.priceCache.values()) {
      if (entry.key.platform === platform) {
        const ageMs = now - new Date(entry.lastUpdatedAt).getTime();
        entries.push({ ...entry, ageMs });
      }
    }

    return entries;
  }

  /**
   * Check if a cached price is stale (older than maxAgeMs)
   */
  isPriceStale(key: LiveMarketKey, maxAgeMs: number): boolean {
    const entry = this.getLivePrice(key);
    if (!entry) return true;
    return (entry.ageMs ?? 0) > maxAgeMs;
  }

  /**
   * Remove a specific price from the cache
   */
  removeLivePrice(key: LiveMarketKey): boolean {
    const keyStr = serializeLiveMarketKey(key);
    return this.priceCache.delete(keyStr);
  }

  /**
   * Clear all prices for a platform
   */
  clearPlatformPrices(platform: MarketPlatform): number {
    let cleared = 0;
    for (const [keyStr, entry] of this.priceCache.entries()) {
      if (entry.key.platform === platform) {
        this.priceCache.delete(keyStr);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Clear all prices from the cache
   */
  clearAllPrices(): void {
    this.priceCache.clear();
  }

  // --------------------------------------------------------------------------
  // Score Cache Operations (SX.bet only)
  // --------------------------------------------------------------------------

  /**
   * Update a live score in the cache.
   * Called by SX.bet WebSocket handler when it receives score updates.
   */
  updateLiveScore(update: LiveScoreUpdate): void {
    const entry: LiveScoreEntry = {
      fixtureId: update.fixtureId,
      homeScore: update.homeScore,
      awayScore: update.awayScore,
      gamePhase: update.gamePhase,
      period: update.period,
      clockTime: update.clockTime,
      lastUpdatedAt: new Date().toISOString(),
      sportLabel: update.sportLabel,
    };

    this.scoreCache.set(update.fixtureId, entry);
    this.stats.totalScoreUpdates++;

    // Notify subscribers
    for (const handler of this.scoreHandlers) {
      try {
        handler(update);
      } catch (err) {
        console.error('[LivePriceCache] Error in score handler:', err);
      }
    }
  }

  /**
   * Get a live score from the cache
   */
  getScore(fixtureId: string): LiveScoreEntry | undefined {
    return this.scoreCache.get(fixtureId);
  }

  /**
   * Get all cached scores
   */
  getAllScores(): LiveScoreEntry[] {
    return Array.from(this.scoreCache.values());
  }

  /**
   * Get scores for games that are currently live
   */
  getLiveGameScores(): LiveScoreEntry[] {
    return this.getAllScores().filter(
      (s) => s.gamePhase === 'live' || s.gamePhase === 'halftime'
    );
  }

  /**
   * Clear all scores from the cache
   */
  clearAllScores(): void {
    this.scoreCache.clear();
  }

  // --------------------------------------------------------------------------
  // Subscription Management
  // --------------------------------------------------------------------------

  /**
   * Subscribe to price updates
   */
  onPriceUpdate(handler: LivePriceHandler): () => void {
    this.priceHandlers.add(handler);
    return () => this.priceHandlers.delete(handler);
  }

  /**
   * Subscribe to score updates
   */
  onScoreUpdate(handler: LiveScoreHandler): () => void {
    this.scoreHandlers.add(handler);
    return () => this.scoreHandlers.delete(handler);
  }

  // --------------------------------------------------------------------------
  // Effective Price Resolution
  // --------------------------------------------------------------------------

  /**
   * Get the effective price for a market, preferring live data over snapshot.
   * This is the key integration point for the bot.
   *
   * @param market The Market object from snapshot
   * @param side 'yes' or 'no'
   * @param maxLivePriceAgeMs Maximum age of live price to use (default 2000ms)
   * @returns The effective price and whether it came from live data
   */
  getEffectivePrice(
    market: Market,
    side: 'yes' | 'no',
    maxLivePriceAgeMs: number = 2000
  ): {
    price: number;
    source: 'live' | 'snapshot';
    ageMs?: number;
  } {
    const key: LiveMarketKey = {
      platform: market.platform,
      marketId: market.id,
      outcomeId: side,
    };

    const liveEntry = this.getLivePrice(key);

    // If we have a fresh live price, use it
    if (liveEntry && (liveEntry.ageMs ?? 0) <= maxLivePriceAgeMs) {
      return {
        price: liveEntry.price,
        source: 'live',
        ageMs: liveEntry.ageMs,
      };
    }

    // Fall back to snapshot price
    const snapshotPrice = side === 'yes' ? market.yesPrice : market.noPrice;
    return {
      price: snapshotPrice,
      source: 'snapshot',
    };
  }

  /**
   * Get effective prices for both sides of a market
   */
  getEffectiveMarketPrices(
    market: Market,
    maxLivePriceAgeMs: number = 2000
  ): {
    yesPrice: number;
    noPrice: number;
    yesSource: 'live' | 'snapshot';
    noSource: 'live' | 'snapshot';
    maxAgeMs?: number;
  } {
    const yes = this.getEffectivePrice(market, 'yes', maxLivePriceAgeMs);
    const no = this.getEffectivePrice(market, 'no', maxLivePriceAgeMs);

    return {
      yesPrice: yes.price,
      noPrice: no.price,
      yesSource: yes.source,
      noSource: no.source,
      maxAgeMs: Math.max(yes.ageMs ?? 0, no.ageMs ?? 0),
    };
  }

  // --------------------------------------------------------------------------
  // Statistics & Monitoring
  // --------------------------------------------------------------------------

  /**
   * Get cache statistics for monitoring
   */
  getStats(): {
    priceCacheSize: number;
    scoreCacheSize: number;
    totalPriceUpdates: number;
    totalScoreUpdates: number;
    priceUpdatesByPlatform: Record<MarketPlatform, number>;
    priceHandlerCount: number;
    scoreHandlerCount: number;
  } {
    return {
      priceCacheSize: this.priceCache.size,
      scoreCacheSize: this.scoreCache.size,
      totalPriceUpdates: this.stats.totalPriceUpdates,
      totalScoreUpdates: this.stats.totalScoreUpdates,
      priceUpdatesByPlatform: { ...this.stats.priceUpdatesByPlatform },
      priceHandlerCount: this.priceHandlers.size,
      scoreHandlerCount: this.scoreHandlers.size,
    };
  }

  /**
   * Get all cached prices as an array (for debugging/logging)
   */
  getAllPrices(): LivePriceEntry[] {
    const entries: LivePriceEntry[] = [];
    const now = Date.now();

    for (const entry of this.priceCache.values()) {
      const ageMs = now - new Date(entry.lastUpdatedAt).getTime();
      entries.push({ ...entry, ageMs });
    }

    return entries;
  }

  /**
   * Get count of cached prices by platform
   */
  getPriceCountByPlatform(): Record<MarketPlatform, number> {
    const counts: Record<MarketPlatform, number> = {
      kalshi: 0,
      polymarket: 0,
      sxbet: 0,
    };

    for (const entry of this.priceCache.values()) {
      counts[entry.key.platform]++;
    }

    return counts;
  }

  /**
   * Reset statistics (for testing)
   */
  resetStats(): void {
    this.stats.totalPriceUpdates = 0;
    this.stats.totalScoreUpdates = 0;
    this.stats.priceUpdatesByPlatform = {
      kalshi: 0,
      polymarket: 0,
      sxbet: 0,
    };
  }

  /**
   * Clear everything (for testing/reset)
   */
  clearAll(): void {
    this.priceCache.clear();
    this.scoreCache.clear();
    this.resetStats();
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global singleton instance of the Live Price Cache.
 * Use this throughout the codebase to access live price data.
 */
export const LivePriceCache = new LivePriceCacheImpl();

// Also export the class for testing purposes
export { LivePriceCacheImpl };

