/**
 * Live Arb Manager
 *
 * Orchestrates WebSocket clients and live price cache for live-event arbitrage.
 * This is the main integration point that ties:
 * - WebSocket clients (SX.bet, Polymarket, Kalshi)
 * - LivePriceCache
 * - HotMarketTracker
 * - Existing arbitrage detection
 *
 * Design decisions:
 * - Singleton pattern matching existing lib/ modules
 * - Non-blocking initialization (WS connects can happen in background)
 * - Integrates with existing AdaptiveScanner and HotMarketTracker
 * - Respects existing circuit breakers and config
 * - Smart subscription management to avoid subscribing to everything
 * - Debounced subscription updates to prevent thrashing
 */

import {
  LiveArbConfig,
  LiveArbOpportunity,
  LivePriceHandler,
  LiveScoreHandler,
  WsClientStatus,
  DEFAULT_LIVE_ARB_CONFIG,
  CircuitBreakerState,
  CircuitBreakerConfig,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  LivePriceUpdate,
  LiveScoreUpdate,
} from '@/types/live-arb';
import { Market, ArbitrageOpportunity, TrackedMarket, MarketPlatform } from '@/types';
import { LivePriceCache } from './live-price-cache';
import { getSxBetWsClient, SxBetWsClient } from '@/services/sxbet-ws';
import { getPolymarketWsClient, PolymarketWsClient } from '@/services/polymarket-ws';
import { getKalshiWsClient, KalshiWsClient } from '@/services/kalshi-ws';
import { HotMarketTracker } from './hot-market-tracker';
import { scanArbitrageOpportunities } from './arbitrage';
import { liveArbLog } from './live-arb-logger';

// ============================================================================
// Subscription Management Configuration
// ============================================================================

interface SubscriptionConfig {
  /** Minimum time between subscription batch updates (ms) */
  debounceMs: number;
  /** Maximum markets to subscribe per platform */
  maxMarketsPerPlatform: number;
  /** Only subscribe to live/imminent events */
  liveEventsOnly: boolean;
  /** Hours until expiry to consider "imminent" */
  imminentHours: number;
}

const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionConfig = {
  debounceMs: 1000, // 1 second debounce
  maxMarketsPerPlatform: 100, // Limit per platform
  liveEventsOnly: false,
  imminentHours: 3, // 3 hours
};

const LOG_TAG = 'LiveArbManager';
const SUBSCRIPTION_REASON_MAX = 5;

// ============================================================================
// Subscription Stats for Monitoring
// ============================================================================

interface SubscriptionStats {
  lastUpdateAt?: string;
  updateCount: number;
  currentSubscriptions: Record<MarketPlatform, number>;
  blockedOpportunities: number;
  blockedReasons: Record<string, number>;
}

// ============================================================================
// Live Arb Manager Implementation
// ============================================================================

class LiveArbManagerImpl {
  private config: LiveArbConfig;
  private subscriptionConfig: SubscriptionConfig;
  private circuitBreakerConfig: CircuitBreakerConfig;
  private circuitBreakerState: CircuitBreakerState;

  private sxBetWs: SxBetWsClient | null = null;
  private polymarketWs: PolymarketWsClient | null = null;
  private kalshiWs: KalshiWsClient | null = null;

  private hotMarketTracker: HotMarketTracker | null = null;
  private isInitialized = false;

  private priceUpdateHandlers: Set<LivePriceHandler> = new Set();
  private scoreUpdateHandlers: Set<LiveScoreHandler> = new Set();
  private arbOpportunityHandlers: Set<(opp: LiveArbOpportunity) => void> =
    new Set();

  // Throttle arb checks to avoid overwhelming the system
  private lastArbCheckTime = 0;
  private minArbCheckIntervalMs = 100; // Max 10 checks per second

  // Subscription management
  private subscriptionDebounceTimer: NodeJS.Timeout | null = null;
  private pendingSubscriptionUpdate = false;
  private pendingSubscriptionReasons: Set<string> = new Set();
  private currentSubscribedMarkets: Map<MarketPlatform, Set<string>> = new Map([
    ['sxbet', new Set()],
    ['polymarket', new Set()],
    ['kalshi', new Set()],
  ]);

  // Statistics
  private stats: SubscriptionStats = {
    updateCount: 0,
    currentSubscriptions: { sxbet: 0, polymarket: 0, kalshi: 0 },
    blockedOpportunities: 0,
    blockedReasons: {},
  };

  constructor() {
    this.config = { ...DEFAULT_LIVE_ARB_CONFIG };
    this.subscriptionConfig = { ...DEFAULT_SUBSCRIPTION_CONFIG };
    this.circuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG };
    this.circuitBreakerState = {
      isOpen: false,
      consecutiveFailures: 0,
    };
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the live arb manager.
   * Connects to all WebSocket feeds and sets up event handlers.
   */
  async initialize(
    config?: Partial<LiveArbConfig>,
    tracker?: HotMarketTracker
  ): Promise<void> {
    if (this.isInitialized) {
      liveArbLog('debug', LOG_TAG, 'initialize() called but manager is already initialized');
      return;
    }

    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Update subscription config from live arb config
    this.subscriptionConfig.liveEventsOnly = this.config.liveEventsOnly ?? false;

    const platformSummary = this.config.enabledPlatforms.join(',');
    const maxSubscriptions = {
      sxbet: this.subscriptionConfig.maxMarketsPerPlatform,
      polymarket: this.subscriptionConfig.maxMarketsPerPlatform,
      kalshi: this.subscriptionConfig.maxMarketsPerPlatform,
    };
    liveArbLog('info', LOG_TAG, 'Starting LiveArbManager', {
      enabled: this.config.enabled,
      liveEventsOnly: this.subscriptionConfig.liveEventsOnly,
      maxSubscriptions,
      platforms: platformSummary,
    });

    if (!this.config.enabled) {
      liveArbLog(
        'info',
        LOG_TAG,
        'liveArbEnabled=false – skipping WebSocket startup and arb scanning (check /api/live-arb/config)'
      );
      return;
    }

    liveArbLog(
      'debug',
      LOG_TAG,
      `Config snapshot: liveEventsOnly=${this.subscriptionConfig.liveEventsOnly}, maxMarketsPerPlatform=${this.subscriptionConfig.maxMarketsPerPlatform}`
    );

    this.hotMarketTracker = tracker ?? null;

    // Set up cache event handlers
    this.setupCacheHandlers();

    // Initialize WebSocket clients for enabled platforms
    const initPromises: Promise<void>[] = [];

    if (this.config.enabledPlatforms.includes('sxbet')) {
      initPromises.push(this.initSxBetWs());
    }

    if (this.config.enabledPlatforms.includes('polymarket')) {
      initPromises.push(this.initPolymarketWs());
    }

    if (this.config.enabledPlatforms.includes('kalshi')) {
      initPromises.push(this.initKalshiWs());
    }

    // Wait for all connections (with timeout handling)
    const results = await Promise.allSettled(initPromises);

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    liveArbLog(
      failed ? 'warn' : 'info',
      LOG_TAG,
      `Initialization complete: ${succeeded}/${results.length} websocket clients connected (${failed} failed)`
    );

    this.isInitialized = true;
  }

  /**
   * Shut down the live arb manager
   */
  async shutdown(): Promise<void> {
    liveArbLog('info', LOG_TAG, 'Shutting down LiveArbManager');

    // Clear debounce timer
    if (this.subscriptionDebounceTimer) {
      clearTimeout(this.subscriptionDebounceTimer);
      this.subscriptionDebounceTimer = null;
    }

    this.sxBetWs?.disconnect();
    this.polymarketWs?.disconnect();
    this.kalshiWs?.disconnect();

    LivePriceCache.clearAll();

    this.sxBetWs = null;
    this.polymarketWs = null;
    this.kalshiWs = null;
    this.isInitialized = false;

    liveArbLog('info', LOG_TAG, 'Shutdown complete');
  }

  private async initSxBetWs(): Promise<void> {
    try {
      this.sxBetWs = getSxBetWsClient();

      this.sxBetWs.onStateChange((status) => {
        liveArbLog('info', 'SXBET-WS', `State changed to ${status.state}`);
        // Re-trigger subscription update on reconnect
        if (status.state === 'connected') {
          this.scheduleSubscriptionUpdate('sxbet_ws_connected');
        }
      });

      await this.sxBetWs.connect();

      // Subscribe to global feeds only (not individual markets yet)
      // Individual markets will be subscribed via smart subscription management
      this.sxBetWs.subscribeToBestOdds();
      this.sxBetWs.subscribeToLiveScores();
      this.sxBetWs.subscribeToLineChanges();

      liveArbLog('info', 'SXBET-WS', 'Initialized websocket client');
    } catch (error) {
      liveArbLog('error', 'SXBET-WS', 'Failed to initialize websocket client', error as Error);
      // Don't throw - allow graceful degradation
    }
  }

  private async initPolymarketWs(): Promise<void> {
    try {
      this.polymarketWs = getPolymarketWsClient();

      this.polymarketWs.onStateChange((status) => {
        liveArbLog('info', 'POLYMARKET-WS', `State changed to ${status.state}`);
        if (status.state === 'connected') {
          this.scheduleSubscriptionUpdate('polymarket_ws_connected');
        }
      });

      await this.polymarketWs.connect();
      liveArbLog('info', 'POLYMARKET-WS', 'Initialized websocket client');
    } catch (error) {
      liveArbLog('error', 'POLYMARKET-WS', 'Failed to initialize websocket client', error as Error);
      // Don't throw - allow graceful degradation
    }
  }

  private async initKalshiWs(): Promise<void> {
    try {
      this.kalshiWs = getKalshiWsClient();

      this.kalshiWs.onStateChange((status) => {
        liveArbLog('info', 'KALSHI-WS', `State changed to ${status.state}`);
        if (status.state === 'connected') {
          this.scheduleSubscriptionUpdate('kalshi_ws_connected');
        }
      });

      await this.kalshiWs.connect();
      liveArbLog('info', 'KALSHI-WS', 'Initialized websocket client');
    } catch (error) {
      liveArbLog('error', 'KALSHI-WS', 'Failed to initialize websocket client', error as Error);
      // Don't throw - allow graceful degradation
    }
  }

  // --------------------------------------------------------------------------
  // Cache Event Handlers
  // --------------------------------------------------------------------------

  private setupCacheHandlers(): void {
    // Subscribe to price updates from cache
    LivePriceCache.onPriceUpdate((update) => {
      this.handlePriceUpdate(update);
    });

    // Subscribe to score updates (SX.bet only)
    LivePriceCache.onScoreUpdate((update) => {
      this.handleScoreUpdate(update);
    });
  }

  private handlePriceUpdate(update: LivePriceUpdate): void {
    // Notify registered handlers
    for (const handler of this.priceUpdateHandlers) {
      try {
        handler(update);
      } catch (error) {
        liveArbLog('error', LOG_TAG, 'Error in price handler', error as Error);
      }
    }

    // Trigger live arb check (throttled)
    this.maybeCheckForArbitrage(update.key.marketId, update.key.platform);
  }

  private handleScoreUpdate(update: LiveScoreUpdate): void {
    // Notify registered handlers
    for (const handler of this.scoreUpdateHandlers) {
      try {
        handler(update);
      } catch (error) {
        liveArbLog('error', LOG_TAG, 'Error in score handler', error as Error);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Smart Subscription Management
  // --------------------------------------------------------------------------

  /**
   * Schedule a debounced subscription update.
   * This prevents thrashing when markets are added/removed frequently.
   */
  private scheduleSubscriptionUpdate(reason: string = 'timer'): void {
    if (this.pendingSubscriptionReasons.size < SUBSCRIPTION_REASON_MAX) {
      this.pendingSubscriptionReasons.add(reason);
    }
    if (this.subscriptionDebounceTimer) {
      // Already scheduled, just mark as pending
      this.pendingSubscriptionUpdate = true;
      return;
    }

    this.pendingSubscriptionUpdate = true;
    this.subscriptionDebounceTimer = setTimeout(() => {
      this.subscriptionDebounceTimer = null;
      if (this.pendingSubscriptionUpdate) {
        this.pendingSubscriptionUpdate = false;
        const reasons = Array.from(this.pendingSubscriptionReasons);
        this.pendingSubscriptionReasons.clear();
        this.updateSubscriptions(reasons);
      }
    }, this.subscriptionConfig.debounceMs);
  }

  /**
   * Update subscriptions based on current hot markets.
   * Called after debounce timer expires.
   */
  private updateSubscriptions(reasons: string[] = []): void {
    if (!this.isInitialized || !this.hotMarketTracker) {
      liveArbLog(
        'debug',
        LOG_TAG,
        'Skipping subscription update because HotMarketTracker is unavailable or manager not initialized'
      );
      return;
    }

    const trackedMarkets = this.getMarketsToSubscribe();
    const totalTargets = trackedMarkets.length;
    if (totalTargets === 0) {
      liveArbLog(
        'debug',
        LOG_TAG,
        'No tracked markets available for subscription',
        { reasons }
      );
    }
    
    // Group by platform
    const byPlatform: Record<MarketPlatform, string[]> = {
      sxbet: [],
      polymarket: [],
      kalshi: [],
    };

    for (const tracked of trackedMarkets) {
      for (const platformMarket of tracked.platforms) {
        if (byPlatform[platformMarket.platform].length < this.subscriptionConfig.maxMarketsPerPlatform) {
          byPlatform[platformMarket.platform].push(platformMarket.marketId);
        }
      }
    }

    // Update each platform
    for (const platform of Object.keys(byPlatform) as MarketPlatform[]) {
      const newMarkets = new Set(byPlatform[platform]);
      const currentMarkets = this.currentSubscribedMarkets.get(platform) || new Set();

      // Find markets to add
      const toAdd = [...newMarkets].filter(m => !currentMarkets.has(m));
      // Find markets to remove
      const toRemove = [...currentMarkets].filter(m => !newMarkets.has(m));

      const platformTag = `${platform.toUpperCase()}-WS`;
      liveArbLog('debug', platformTag, 'applySubscriptionChanges', {
        add: toAdd.length,
        remove: toRemove.length,
        totalActive: newMarkets.size,
      });

      // Apply changes
      this.applySubscriptionChanges(platform, toAdd, toRemove);

      // Update current state
      this.currentSubscribedMarkets.set(platform, newMarkets);
      this.stats.currentSubscriptions[platform] = newMarkets.size;
    }

    this.stats.lastUpdateAt = new Date().toISOString();
    this.stats.updateCount++;
    const reasonLabel = reasons.length ? reasons.join(',') : 'unknown';
    liveArbLog('debug', LOG_TAG, `Subscription update #${this.stats.updateCount} (reason=${reasonLabel})`, {
      sxbet: this.stats.currentSubscriptions.sxbet,
      polymarket: this.stats.currentSubscriptions.polymarket,
      kalshi: this.stats.currentSubscriptions.kalshi,
    });
  }

  /**
   * Get the list of markets we should subscribe to.
   * Filters based on config (live events only, max per platform, etc.)
   */
  private getMarketsToSubscribe(): TrackedMarket[] {
    if (!this.hotMarketTracker) {
      return [];
    }

    let trackedMarkets = this.hotMarketTracker.getAllTrackedMarkets();

    // Filter to live events only if configured
    if (this.subscriptionConfig.liveEventsOnly) {
      trackedMarkets = trackedMarkets.filter(m => m.isLive);
    } else {
      // Otherwise, include imminent events (expiring soon)
      const now = Date.now();
      const imminentCutoff = now + this.subscriptionConfig.imminentHours * 60 * 60 * 1000;
      
      trackedMarkets = trackedMarkets.filter(m => {
        if (m.isLive) return true;
        const expiryMs = new Date(m.expiryDate).getTime();
        return expiryMs > now && expiryMs <= imminentCutoff;
      });
    }

    // Sort by priority: live first, then by expiry (soonest first)
    trackedMarkets.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
    });

    return trackedMarkets;
  }

  /**
   * Apply subscription changes for a platform
   */
  private applySubscriptionChanges(
    platform: MarketPlatform,
    toAdd: string[],
    toRemove: string[]
  ): void {
    const client = this.getWsClient(platform);
    if (!client?.isConnected()) {
      liveArbLog(
        'debug',
        `${platform.toUpperCase()}-WS`,
        'Cannot apply subscription changes because websocket client is not connected'
      );
      return;
    }

    // Remove old subscriptions
    if (toRemove.length > 0) {
      switch (platform) {
        case 'sxbet':
          (client as SxBetWsClient).unsubscribeFromMarkets(toRemove);
          break;
        case 'polymarket':
          for (const id of toRemove) {
            (client as PolymarketWsClient).unsubscribeFromMarket(id);
          }
          break;
        case 'kalshi':
          for (const id of toRemove) {
            (client as KalshiWsClient).unsubscribeFromMarket(id);
          }
          break;
      }
    }

    // Add new subscriptions
    if (toAdd.length > 0) {
      switch (platform) {
        case 'sxbet':
          (client as SxBetWsClient).subscribeToMarkets(toAdd);
          break;
        case 'polymarket':
          (client as PolymarketWsClient).subscribeToMarkets(toAdd);
          break;
        case 'kalshi':
          (client as KalshiWsClient).subscribeToMarkets(toAdd);
          break;
      }
    }
  }

  private getWsClient(platform: MarketPlatform): SxBetWsClient | PolymarketWsClient | KalshiWsClient | null {
    switch (platform) {
      case 'sxbet': return this.sxBetWs;
      case 'polymarket': return this.polymarketWs;
      case 'kalshi': return this.kalshiWs;
    }
  }

  /**
   * Subscribe to live updates for tracked markets.
   * Call this after HotMarketTracker has been populated.
   * Now uses debounced smart subscription management.
   */
  subscribeToTrackedMarkets(trackedMarkets: TrackedMarket[]): void {
    if (!this.isInitialized) {
      liveArbLog('warn', LOG_TAG, 'Cannot subscribe to tracked markets because manager is not initialized');
      return;
    }

    // Just trigger a subscription update - the smart management will handle it
    this.scheduleSubscriptionUpdate('hot_markets_updated');
  }

  /**
   * Subscribe to a single market on a specific platform
   */
  subscribeToMarket(platform: MarketPlatform, marketId: string): void {
    if (!this.isInitialized) return;

    switch (platform) {
      case 'sxbet':
        this.sxBetWs?.subscribeToMarket(marketId);
        break;
      case 'polymarket':
        this.polymarketWs?.subscribeToMarket(marketId);
        break;
      case 'kalshi':
        this.kalshiWs?.subscribeToMarket(marketId);
        break;
    }
  }

  // --------------------------------------------------------------------------
  // Live Arbitrage Detection
  // --------------------------------------------------------------------------

  /**
   * Throttled arb check triggered by price updates
   */
  private maybeCheckForArbitrage(
    marketId: string,
    platform: MarketPlatform
  ): void {
    if (!this.config.enabled) return;
    if (this.circuitBreakerState.isOpen) return;

    const now = Date.now();
    if (now - this.lastArbCheckTime < this.minArbCheckIntervalMs) {
      return; // Throttled
    }
    this.lastArbCheckTime = now;

    // Find matching markets across platforms
    if (!this.hotMarketTracker) return;

    const tracked = this.hotMarketTracker.getAllTrackedMarkets();
    const matchingTracked = tracked.find((t) =>
      t.platforms.some((p) => p.marketId === marketId && p.platform === platform)
    );

    if (!matchingTracked || matchingTracked.platforms.length < 2) {
      return; // No cross-platform match
    }

    // Run arb check on this tracked market
    this.checkArbForTrackedMarket(matchingTracked);
  }

  /**
   * Check for arbitrage on a specific tracked market
   */
  private checkArbForTrackedMarket(tracked: TrackedMarket): void {
    const combinations = this.getMarketCombinations(tracked);

    for (const [market1, market2] of combinations) {
      // Get effective prices (live if available, snapshot otherwise)
      const prices1 = LivePriceCache.getEffectiveMarketPrices(
        market1,
        this.config.maxPriceAgeMs
      );
      const prices2 = LivePriceCache.getEffectiveMarketPrices(
        market2,
        this.config.maxPriceAgeMs
      );

      // Check if we have fresh enough prices
      if (prices1.maxAgeMs && prices1.maxAgeMs > this.config.maxPriceAgeMs) {
        continue;
      }
      if (prices2.maxAgeMs && prices2.maxAgeMs > this.config.maxPriceAgeMs) {
        continue;
      }

      // Create updated market objects with live prices
      const liveMarket1: Market = {
        ...market1,
        yesPrice: prices1.yesPrice,
        noPrice: prices1.noPrice,
      };
      const liveMarket2: Market = {
        ...market2,
        yesPrice: prices2.yesPrice,
        noPrice: prices2.noPrice,
      };

      // Run arb scan using existing engine (no duplication!)
      const minProfitMargin = this.config.minProfitBps / 100; // Convert bps to %
      const result = scanArbitrageOpportunities(
        [liveMarket1],
        [liveMarket2],
        minProfitMargin,
        { label: 'live', silent: true }
      );

      if (result.opportunities.length > 0) {
        for (const opp of result.opportunities) {
          const liveOpp = this.convertToLiveOpportunity(
            opp,
            prices1,
            prices2,
            tracked
          );
          this.notifyArbOpportunity(liveOpp);
        }
      }
    }
  }

  /**
   * Get all market combinations for a tracked market
   */
  private getMarketCombinations(tracked: TrackedMarket): [Market, Market][] {
    const combinations: [Market, Market][] = [];
    const markets = tracked.platforms.map((p) => p.market);

    for (let i = 0; i < markets.length; i++) {
      for (let j = i + 1; j < markets.length; j++) {
        combinations.push([markets[i], markets[j]]);
      }
    }

    return combinations;
  }

  /**
   * Convert standard ArbitrageOpportunity to LiveArbOpportunity
   */
  private convertToLiveOpportunity(
    opp: ArbitrageOpportunity,
    prices1: { yesSource: string; noSource: string; maxAgeMs?: number },
    prices2: { yesSource: string; noSource: string; maxAgeMs?: number },
    tracked: TrackedMarket
  ): LiveArbOpportunity {
    const maxAgeMs = Math.max(prices1.maxAgeMs ?? 0, prices2.maxAgeMs ?? 0);

    // Get live score if this is an SX.bet market
    const sxbetPlatform = tracked.platforms.find((p) => p.platform === 'sxbet');
    let liveScore = undefined;
    if (sxbetPlatform) {
      const score = LivePriceCache.getScore(sxbetPlatform.marketId);
      if (score) {
        liveScore = score;
      }
    }

    return {
      ...opp,
      detectedAt: new Date().toISOString(),
      maxPriceAgeMs: maxAgeMs,
      hasLiveScoreContext: !!liveScore,
      liveScore,
      priceSource: {
        market1: prices1.yesSource as 'websocket' | 'rest' | 'snapshot',
        market2: prices2.yesSource as 'websocket' | 'rest' | 'snapshot',
      },
    };
  }

  private notifyArbOpportunity(opp: LiveArbOpportunity): void {
    liveArbLog(
      'info',
      LOG_TAG,
      `LIVE ARB DETECTED ${opp.market1.title} (${opp.market1.platform} vs ${opp.market2.platform}) profit=${opp.profitMargin.toFixed(
        2
      )}%`
    );

    for (const handler of this.arbOpportunityHandlers) {
      try {
        handler(opp);
      } catch (error) {
        liveArbLog('error', LOG_TAG, 'Error in arb opportunity handler', error as Error);
        this.recordFailure();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Circuit Breaker
  // --------------------------------------------------------------------------

  private recordFailure(): void {
    this.circuitBreakerState.consecutiveFailures++;
    this.circuitBreakerState.lastError = 'Handler error';

    if (
      this.circuitBreakerState.consecutiveFailures >=
      this.circuitBreakerConfig.maxConsecutiveFailures
    ) {
      this.openCircuit('Max consecutive failures reached');
    }
  }

  private openCircuit(reason: string): void {
    this.circuitBreakerState.isOpen = true;
    this.circuitBreakerState.openReason = reason;
    this.circuitBreakerState.openedAt = new Date().toISOString();

    liveArbLog('warn', LOG_TAG, `Circuit opened: ${reason}`);

    // Schedule circuit reset
    setTimeout(() => {
      this.resetCircuit();
    }, this.circuitBreakerConfig.cooldownMs);
  }

  private resetCircuit(): void {
    liveArbLog('info', LOG_TAG, 'Circuit reset');
    this.circuitBreakerState = {
      isOpen: false,
      consecutiveFailures: 0,
    };
  }

  /**
   * Record a blocked opportunity for stats
   */
  recordBlockedOpportunity(reason: string): void {
    this.stats.blockedOpportunities++;
    this.stats.blockedReasons[reason] = (this.stats.blockedReasons[reason] || 0) + 1;
  }

  /**
   * Check if price data is stale (circuit breaker check)
   */
  isPriceStale(platform: MarketPlatform, marketId: string): boolean {
    const key = {
      platform,
      marketId,
      outcomeId: 'yes',
    };
    return LivePriceCache.isPriceStale(key, this.config.maxPriceAgeMs);
  }

  // --------------------------------------------------------------------------
  // Event Subscriptions
  // --------------------------------------------------------------------------

  /**
   * Subscribe to all price updates
   */
  onPriceUpdate(handler: LivePriceHandler): () => void {
    this.priceUpdateHandlers.add(handler);
    return () => this.priceUpdateHandlers.delete(handler);
  }

  /**
   * Subscribe to score updates (SX.bet only)
   */
  onScoreUpdate(handler: LiveScoreHandler): () => void {
    this.scoreUpdateHandlers.add(handler);
    return () => this.scoreUpdateHandlers.delete(handler);
  }

  /**
   * Subscribe to live arb opportunities
   */
  onArbOpportunity(
    handler: (opp: LiveArbOpportunity) => void
  ): () => void {
    this.arbOpportunityHandlers.add(handler);
    return () => this.arbOpportunityHandlers.delete(handler);
  }

  // --------------------------------------------------------------------------
  // Status & Configuration
  // --------------------------------------------------------------------------

  /**
   * Update live arb configuration
   */
  updateConfig(config: Partial<LiveArbConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update subscription config if relevant settings changed
    if (config.liveEventsOnly !== undefined) {
      this.subscriptionConfig.liveEventsOnly = config.liveEventsOnly;
      this.scheduleSubscriptionUpdate('config_updated');
    }
    
    liveArbLog('info', LOG_TAG, 'Config updated', this.config);
  }

  /**
   * Update subscription configuration
   */
  updateSubscriptionConfig(config: Partial<SubscriptionConfig>): void {
    this.subscriptionConfig = { ...this.subscriptionConfig, ...config };
    this.scheduleSubscriptionUpdate();
  }

  /**
   * Update circuit breaker configuration
   */
  updateCircuitBreakerConfig(config: Partial<CircuitBreakerConfig>): void {
    this.circuitBreakerConfig = { ...this.circuitBreakerConfig, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): LiveArbConfig {
    return { ...this.config };
  }

  /**
   * Get subscription configuration
   */
  getSubscriptionConfig(): SubscriptionConfig {
    return { ...this.subscriptionConfig };
  }

  /**
   * Get WebSocket connection statuses
   */
  getWsStatuses(): Record<MarketPlatform, WsClientStatus | null> {
    return {
      sxbet: this.sxBetWs?.getStatus() ?? null,
      polymarket: this.polymarketWs?.getStatus() ?? null,
      kalshi: this.kalshiWs?.getStatus() ?? null,
    };
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreakerState };
  }

  /**
   * Get subscription stats
   */
  getSubscriptionStats(): SubscriptionStats {
    return { ...this.stats };
  }

  /**
   * Get overall manager status
   */
  getStatus(): {
    initialized: boolean;
    enabled: boolean;
    wsConnections: Record<MarketPlatform, boolean>;
    circuitBreaker: CircuitBreakerState;
    cacheStats: ReturnType<typeof LivePriceCache.getStats>;
    subscriptionStats: SubscriptionStats;
  } {
    return {
      initialized: this.isInitialized,
      enabled: this.config.enabled,
      wsConnections: {
        sxbet: this.sxBetWs?.isConnected() ?? false,
        polymarket: this.polymarketWs?.isConnected() ?? false,
        kalshi: this.kalshiWs?.isConnected() ?? false,
      },
      circuitBreaker: this.getCircuitBreakerState(),
      cacheStats: LivePriceCache.getStats(),
      subscriptionStats: this.stats,
    };
  }

  /**
   * Set the HotMarketTracker reference
   */
  setHotMarketTracker(tracker: HotMarketTracker): void {
    this.hotMarketTracker = tracker;
    // Trigger subscription update with new tracker
    this.scheduleSubscriptionUpdate();
  }

  /**
   * Check if the manager is ready for live arb
   */
  isReady(): boolean {
    if (!this.isInitialized || !this.config.enabled) return false;
    if (this.circuitBreakerState.isOpen) return false;

    // At least one WS should be connected
    const anyConnected =
      (this.sxBetWs?.isConnected() ?? false) ||
      (this.polymarketWs?.isConnected() ?? false) ||
      (this.kalshiWs?.isConnected() ?? false);

    return anyConnected;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global singleton instance of the Live Arb Manager.
 */
export const LiveArbManager = new LiveArbManagerImpl();

// Also export the class for testing
export { LiveArbManagerImpl };
