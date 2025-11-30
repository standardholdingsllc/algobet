/**
 * Live Event Watchers
 *
 * Manages watchers for matched events that:
 * - Subscribe to price updates via WebSocket (event-driven)
 * - Run arb checks ONLY for markets in the specific MatchedEventGroup
 * - Execute opportunities via the execution wrapper
 *
 * Key improvements:
 * - Event-driven: Triggered by price updates, not blind polling
 * - Scoped: Each watcher only evaluates its own event's markets
 * - Debounced: Prevents check storms on rapid price updates
 * - Instrumented: Tracks timing and performance metrics
 */

import {
  MatchedEventGroup,
  EventWatcherInfo,
  WatcherState,
  LiveEventPlatform,
  VendorEvent,
  toMarketPlatform,
} from '@/types/live-events';
import { buildLiveEventMatcherConfig } from './live-event-config';
import { ArbitrageOpportunity, Market, MarketPlatform } from '@/types';
import { LivePriceUpdate } from '@/types/live-arb';
import { getMatchedEvents, getMatchedGroup } from './live-event-matcher';
import { LivePriceCache } from './live-price-cache';
import { scanArbitrageOpportunities } from './arbitrage';
import { executeOpportunityWithMode, ExecutionOptions, PlatformAdapters, isDryFireMode } from './execution-wrapper';
import { KVStorage } from './kv-storage';
import { LiveArbManager } from './live-arb-manager';
import { liveArbLog } from './live-arb-logger';

const WATCHER_LOG_TAG = 'LiveWatcher';

// ============================================================================
// Debug Configuration
// ============================================================================

const DEBUG_WATCHERS = process.env.DEBUG_LIVE_WATCHERS === 'true';

function debugLog(...args: any[]): void {
  if (DEBUG_WATCHERS) {
    console.log('[Watcher:DEBUG]', ...args);
  }
}

// ============================================================================
// Watcher State
// ============================================================================

interface ActiveWatcher {
  group: MatchedEventGroup;
  state: WatcherState;
  startedAt: number;
  lastPriceUpdateAt?: number;
  lastArbCheckAt?: number;
  lastTrigger?: { platform: MarketPlatform; marketId: string };
  arbCheckCount: number;
  opportunitiesFound: number;
  lastOpportunity?: {
    profitMargin: number;
    platforms: string[];
    foundAt: number;
  };
  /** Fallback timer for safety net polling */
  fallbackTimer?: NodeJS.Timeout;
  /** Debounce timer for price updates */
  debounceTimer?: NodeJS.Timeout;
  /** Flag to prevent concurrent checks */
  isChecking: boolean;
  /** Market ID to eventKey mapping for this group */
  marketIdToEventKey: Map<string, string>;
  /** Timing stats */
  timing: {
    totalCheckTimeMs: number;
    maxCheckTimeMs: number;
    minCheckTimeMs: number;
  };
}

/** Active watchers by event key */
const activeWatchers = new Map<string, ActiveWatcher>();

/** Reverse lookup: marketId -> eventKey (for price update routing) */
const marketIdToWatcher = new Map<string, string>();

/** Configuration */
const FALLBACK_POLL_INTERVAL_MS = 5000;  // Safety net polling every 5s
const DEBOUNCE_MS = 50;                   // Debounce rapid price updates
const MIN_CHECK_INTERVAL_MS = 100;        // Minimum time between checks
const watcherInfo = (message: string, meta?: Record<string, unknown>) =>
  liveArbLog('info', WATCHER_LOG_TAG, message, meta);
const watcherDebug = (message: string, meta?: Record<string, unknown>) =>
  liveArbLog('debug', WATCHER_LOG_TAG, message, meta);
const watcherWarn = (message: string, meta?: Record<string, unknown>) =>
  liveArbLog('warn', WATCHER_LOG_TAG, message, meta);

/** Platform adapters (set during initialization) */
let platformAdapters: PlatformAdapters | null = null;

/** Execution options template */
let executionOptionsTemplate: Partial<ExecutionOptions> | null = null;

/** Price update listener registration */
let priceUpdateUnsubscribe: (() => void) | null = null;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the watchers system with platform adapters
 */
export function initializeWatchers(
  adapters: PlatformAdapters,
  options: Partial<ExecutionOptions>
): void {
  platformAdapters = adapters;
  executionOptionsTemplate = options;
  
  // Register for price updates from LivePriceCache
  priceUpdateUnsubscribe = LivePriceCache.onPriceUpdate(handlePriceUpdate);
  
  watcherInfo('Initialized watchers with platform adapters');
}

/**
 * Cleanup watchers system
 */
export function cleanupWatchers(): void {
  stopAllWatchers();
  
  if (priceUpdateUnsubscribe) {
    priceUpdateUnsubscribe();
    priceUpdateUnsubscribe = null;
  }
  
  marketIdToWatcher.clear();
  watcherInfo('Cleaned up watchers');
}

// ============================================================================
// Event-Driven Price Update Handler
// ============================================================================

/**
 * Handle a price update from LivePriceCache
 * Routes to the appropriate watcher and triggers a debounced arb check
 */
function handlePriceUpdate(update: LivePriceUpdate): void {
  const marketId = update.key.marketId;
  const eventKey = marketIdToWatcher.get(marketId);
  
  if (!eventKey) {
    // Not a market we're watching
    return;
  }
  
  const watcher = activeWatchers.get(eventKey);
  if (!watcher || watcher.state !== 'ACTIVE') {
    return;
  }
  
  watcher.lastPriceUpdateAt = Date.now();
  watcher.lastTrigger = {
    platform: update.key.platform,
    marketId,
  };
  
  debugLog(
    `Price update for ${eventKey}: ${update.key.platform}:${marketId} = ${update.price}`
  );
  
  // Debounced trigger
  triggerDebouncedCheck(eventKey);
}

/**
 * Trigger a debounced arb check for a specific event
 */
function triggerDebouncedCheck(eventKey: string): void {
  const watcher = activeWatchers.get(eventKey);
  if (!watcher) return;
  
  // Clear existing debounce timer
  if (watcher.debounceTimer) {
    clearTimeout(watcher.debounceTimer);
  }
  
  // Set new debounce timer
  watcher.debounceTimer = setTimeout(() => {
    runArbCheck(eventKey);
  }, DEBOUNCE_MS);
}

// ============================================================================
// Market Data Helpers
// ============================================================================

/**
 * Get ONLY the markets belonging to this MatchedEventGroup
 * This ensures we don't scan the entire market universe
 */
function getMarketsForGroup(group: MatchedEventGroup): Market[] {
  const markets: Market[] = [];
  
  for (const platform of ['SXBET', 'POLYMARKET', 'KALSHI'] as LiveEventPlatform[]) {
    const vendorEvents = group.vendors[platform];
    if (!vendorEvents) continue;
    
    const marketPlatform = toMarketPlatform(platform);
    
    for (const ve of vendorEvents) {
      // Get live prices from cache
      const livePrices = LivePriceCache.getMarketPrices(marketPlatform, ve.vendorMarketId);
      
      // Only include if we have at least one price
      if (!livePrices.yes && !livePrices.no) {
        continue;
      }
      
      // Build market object with live prices
      const market: Market = {
        id: ve.vendorMarketId,
        ticker: ve.vendorMarketId,
        platform: marketPlatform,
        marketType: platform === 'SXBET' ? 'sportsbook' : 'prediction',
        title: ve.rawTitle,
        yesPrice: livePrices.yes?.price ?? 50,
        noPrice: livePrices.no?.price ?? 50,
        expiryDate: ve.startTime 
          ? new Date(ve.startTime + 4 * 60 * 60 * 1000).toISOString()
          : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        volume: 0,
        liquidity: 0,
      };
      
      markets.push(market);
    }
  }
  
  return markets;
}

interface RecentPriceStats {
  hasRecent: boolean;
  platformsWithRecent: number;
  stalePlatforms: number;
}

/**
 * Check if we have recent prices for at least 2 platforms in the group
 */
function getRecentPriceStats(group: MatchedEventGroup, maxAgeMs: number = 10000): RecentPriceStats {
  const now = Date.now();
  let platformsWithRecentPrices = 0;
  let stalePlatforms = 0;
  
  for (const platform of ['SXBET', 'POLYMARKET', 'KALSHI'] as LiveEventPlatform[]) {
    const vendorEvents = group.vendors[platform];
    if (!vendorEvents || vendorEvents.length === 0) continue;
    
    const marketPlatform = toMarketPlatform(platform);
    let hasRecent = false;
    
    for (const ve of vendorEvents) {
      const livePrices = LivePriceCache.getMarketPrices(marketPlatform, ve.vendorMarketId);
      
      const yesAge = livePrices.yes?.lastUpdatedAt 
        ? now - new Date(livePrices.yes.lastUpdatedAt).getTime() 
        : Infinity;
      const noAge = livePrices.no?.lastUpdatedAt 
        ? now - new Date(livePrices.no.lastUpdatedAt).getTime() 
        : Infinity;
      
      if (yesAge <= maxAgeMs || noAge <= maxAgeMs) {
        hasRecent = true;
        break;
      }
    }
    
    if (hasRecent) {
      platformsWithRecentPrices++;
    } else {
      stalePlatforms++;
    }
  }
  
  return {
    hasRecent: platformsWithRecentPrices >= 2,
    platformsWithRecent: platformsWithRecentPrices,
    stalePlatforms,
  };
}

/**
 * Register market IDs for a watcher (for price update routing)
 */
function registerWatcherMarkets(watcher: ActiveWatcher): void {
  watcher.marketIdToEventKey.clear();
  
  for (const platform of ['SXBET', 'POLYMARKET', 'KALSHI'] as LiveEventPlatform[]) {
    const vendorEvents = watcher.group.vendors[platform];
    if (!vendorEvents) continue;
    
    const marketPlatform = toMarketPlatform(platform);
    
    for (const ve of vendorEvents) {
      watcher.marketIdToEventKey.set(ve.vendorMarketId, watcher.group.eventKey);
      marketIdToWatcher.set(ve.vendorMarketId, watcher.group.eventKey);
      LiveArbManager.subscribeToMarket(marketPlatform, ve.vendorMarketId);
    }
  }
  
  debugLog(
    `Registered ${watcher.marketIdToEventKey.size} markets for ${watcher.group.eventKey}`
  );
}

/**
 * Unregister market IDs for a watcher
 */
function unregisterWatcherMarkets(watcher: ActiveWatcher): void {
  for (const marketId of watcher.marketIdToEventKey.keys()) {
    marketIdToWatcher.delete(marketId);
  }
  watcher.marketIdToEventKey.clear();
}

// ============================================================================
// Watcher Implementation
// ============================================================================

/**
 * Create and start a watcher for a matched event group
 */
export function startWatcher(group: MatchedEventGroup): boolean {
  const config = buildLiveEventMatcherConfig();
  
  // Check if already watching
  if (activeWatchers.has(group.eventKey)) {
    debugLog(`Already watching ${group.eventKey}`);
    return false;
  }
  
  // Check max watchers
  if (activeWatchers.size >= config.maxWatchers) {
    watcherWarn('Max watcher limit reached', { maxWatchers: config.maxWatchers });
    return false;
  }
  
  // Check platform count
  if (group.platformCount < config.minPlatforms) {
    debugLog(`Not enough platforms (${group.platformCount}) for ${group.eventKey}`);
    return false;
  }
  
  // Create watcher
  const watcher: ActiveWatcher = {
    group,
    state: 'STARTING',
    startedAt: Date.now(),
    arbCheckCount: 0,
    opportunitiesFound: 0,
    isChecking: false,
    marketIdToEventKey: new Map(),
    timing: {
      totalCheckTimeMs: 0,
      maxCheckTimeMs: 0,
      minCheckTimeMs: Infinity,
    },
  };
  
  activeWatchers.set(group.eventKey, watcher);
  
  // Register markets for price update routing
  registerWatcherMarkets(watcher);
  
  // Start fallback polling timer (safety net if WS is spotty)
  watcher.state = 'ACTIVE';
  watcher.fallbackTimer = setInterval(() => {
    // Only run if no recent event-driven check
    const now = Date.now();
    if (!watcher.lastArbCheckAt || now - watcher.lastArbCheckAt > FALLBACK_POLL_INTERVAL_MS / 2) {
      debugLog(`Fallback check for ${group.eventKey}`);
      runArbCheck(group.eventKey);
    }
  }, FALLBACK_POLL_INTERVAL_MS);
  
  watcherInfo('Started watcher', {
    eventKey: group.eventKey,
    sport: group.sport,
    homeTeam: group.homeTeam,
    awayTeam: group.awayTeam,
    platforms: group.platformCount,
    markets: watcher.marketIdToEventKey.size,
  });
  
  return true;
}

/**
 * Stop a watcher
 */
export function stopWatcher(eventKey: string, reason: string = 'manual'): boolean {
  const watcher = activeWatchers.get(eventKey);
  if (!watcher) return false;
  
  watcher.state = 'STOPPING';
  
  // Clear timers
  if (watcher.fallbackTimer) {
    clearInterval(watcher.fallbackTimer);
    watcher.fallbackTimer = undefined;
  }
  if (watcher.debounceTimer) {
    clearTimeout(watcher.debounceTimer);
    watcher.debounceTimer = undefined;
  }
  
  // Unregister markets
  unregisterWatcherMarkets(watcher);
  
  watcher.state = 'STOPPED';
  activeWatchers.delete(eventKey);
  
  watcherInfo('Stopped watcher', {
    eventKey,
    reason,
    arbChecks: watcher.arbCheckCount,
    opportunitiesFound: watcher.opportunitiesFound,
  });
  return true;
}

/**
 * Stop all watchers
 */
export function stopAllWatchers(): void {
  for (const eventKey of [...activeWatchers.keys()]) {
    stopWatcher(eventKey, 'stop_all');
  }
  watcherInfo('All watchers stopped');
}

/**
 * Run an arb check for a watched event
 * ONLY evaluates markets belonging to this specific MatchedEventGroup
 */
async function runArbCheck(eventKey: string): Promise<void> {
  const watcher = activeWatchers.get(eventKey);
  if (!watcher || watcher.state !== 'ACTIVE') return;
  
  // Prevent concurrent checks
  if (watcher.isChecking) {
    watcherDebug('Skipping arb check (already running)', { eventKey });
    debugLog(`Skipping concurrent check for ${eventKey}`);
    return;
  }
  
  // Rate limit checks
  const now = Date.now();
  if (watcher.lastArbCheckAt && now - watcher.lastArbCheckAt < MIN_CHECK_INTERVAL_MS) {
    watcherDebug('Skipping arb check (rate limited)', { eventKey });
    return;
  }
  
  watcher.isChecking = true;
  const checkStartTime = now;
  
  try {
    // Get latest group data (might have updated)
    const group = getMatchedGroup(eventKey) || watcher.group;
    watcherDebug('Running arb check', {
      eventKey,
      triggeredBy: watcher.lastTrigger,
    });
    
    // Skip if no recent prices from at least 2 platforms
    const recentStats = getRecentPriceStats(group, 10000);
    if (!recentStats.hasRecent) {
      watcherDebug('Skip arb check (no fresh prices)', {
        eventKey,
        stalePlatforms: recentStats.stalePlatforms,
      });
      return;
    }
    
    watcher.lastArbCheckAt = now;
    watcher.arbCheckCount++;
    
    // Get ONLY markets for this group (not the entire universe)
    const markets = getMarketsForGroup(group);
    
    debugLog(
      `Checking ${eventKey}: ${markets.length} markets ` +
      `[${markets.map(m => m.platform).join(', ')}]`
    );
    
    if (markets.length < 2) {
      watcherDebug('Skip arb check (insufficient markets)', {
        eventKey,
        marketsAvailable: markets.length,
      });
      return; // Need at least 2 markets to arb
    }
    
    // Separate markets by platform
    const marketsByPlatform: Record<MarketPlatform, Market[]> = {
      kalshi: [],
      polymarket: [],
      sxbet: [],
    };
    
    for (const m of markets) {
      marketsByPlatform[m.platform].push(m);
    }
    
    // Get config for min profit
    const config = await KVStorage.getConfig();
    const minProfitMargin = config.minProfitMargin;
    
    // Run arb scans ONLY between markets in this group
    const opportunities: ArbitrageOpportunity[] = [];
    
    const platforms: MarketPlatform[] = ['kalshi', 'polymarket', 'sxbet'];
    for (let i = 0; i < platforms.length; i++) {
      for (let j = i + 1; j < platforms.length; j++) {
        const markets1 = marketsByPlatform[platforms[i]];
        const markets2 = marketsByPlatform[platforms[j]];
        
        if (markets1.length === 0 || markets2.length === 0) {
          watcherDebug('Skip platform pair due to missing markets', {
            eventKey,
            platformPair: [platforms[i], platforms[j]],
          });
          continue;
        }
        
        const result = scanArbitrageOpportunities(
          markets1,
          markets2,
          minProfitMargin,
          { label: `live-watcher:${eventKey}`, silent: true }
        );
        
        opportunities.push(...result.opportunities);
      }
    }
    
    // Process opportunities
    if (opportunities.length > 0) {
      watcher.opportunitiesFound += opportunities.length;
      
      // Take best opportunity
      opportunities.sort((a, b) => b.profitMargin - a.profitMargin);
      const bestOpp = opportunities[0];
      
      watcher.lastOpportunity = {
        profitMargin: bestOpp.profitMargin,
        platforms: [bestOpp.market1.platform, bestOpp.market2.platform],
        foundAt: now,
      };
      
      watcherInfo('Opportunity found', {
        eventKey,
        profitBps: bestOpp.profitMargin,
        platforms: [bestOpp.market1.platform, bestOpp.market2.platform],
      });
      
      // Execute if we have adapters
      if (platformAdapters && executionOptionsTemplate) {
        await executeOpportunity(bestOpp, group);
      }
    } else {
      watcherDebug('No opportunities detected', { eventKey, marketsEvaluated: markets.length });
    }
    
  } catch (error) {
    liveArbLog('error', WATCHER_LOG_TAG, `Error in arb check for ${eventKey}`, error as Error);
  } finally {
    watcher.isChecking = false;
    
    // Update timing stats
    const checkDuration = Date.now() - checkStartTime;
    watcher.timing.totalCheckTimeMs += checkDuration;
    watcher.timing.maxCheckTimeMs = Math.max(watcher.timing.maxCheckTimeMs, checkDuration);
    watcher.timing.minCheckTimeMs = Math.min(watcher.timing.minCheckTimeMs, checkDuration);
    
    if (DEBUG_WATCHERS && checkDuration > 100) {
      debugLog(`Check for ${eventKey} took ${checkDuration}ms`);
    }
  }
}

/**
 * Execute an opportunity through the wrapper
 */
async function executeOpportunity(
  opportunity: ArbitrageOpportunity,
  group: MatchedEventGroup
): Promise<void> {
  if (!platformAdapters || !executionOptionsTemplate) {
    watcherWarn('Cannot execute opportunity because adapters are not initialized', {
      eventKey: group.eventKey,
    });
    return;
  }
  
  try {
    // Build execution options
    const options: ExecutionOptions = {
      kalshiBalance: executionOptionsTemplate.kalshiBalance || 0,
      polymarketBalance: executionOptionsTemplate.polymarketBalance || 0,
      sxbetBalance: executionOptionsTemplate.sxbetBalance || 0,
      maxBetPercentage: executionOptionsTemplate.maxBetPercentage || 10,
      minProfitMargin: executionOptionsTemplate.minProfitMargin || 0.5,
      maxDaysToExpiry: executionOptionsTemplate.maxDaysToExpiry || 30,
      scanType: 'live',
      safetySnapshot: {
        isLiveEvent: group.status === 'LIVE',
        priceSource: 'websocket',
      },
    };
    
    const result = await executeOpportunityWithMode(
      opportunity,
      options,
      platformAdapters
    );
    
    if (result.success) {
      watcherInfo('Execution succeeded', {
        eventKey: group.eventKey,
        mode: isDryFireMode() ? 'DRY_FIRE' : 'LIVE',
        profitMargin: opportunity.profitMargin,
      });
    } else {
      watcherWarn('Execution skipped or failed', {
        eventKey: group.eventKey,
        reason: result.reason,
      });
    }
    
  } catch (error) {
    liveArbLog('error', WATCHER_LOG_TAG, `Execution error for ${group.eventKey}`, error as Error);
  }
}

// ============================================================================
// Watcher Management
// ============================================================================

/**
 * Update watchers based on current matched groups
 */
export function updateWatchers(): void {
  const config = buildLiveEventMatcherConfig();
  const matchedGroups = getMatchedEvents({ minPlatforms: config.minPlatforms });
  
  // Start watchers for new groups
  for (const group of matchedGroups) {
    if (!activeWatchers.has(group.eventKey)) {
      if (activeWatchers.size < config.maxWatchers) {
        startWatcher(group);
      }
    } else {
      // Update existing watcher's group (might have new markets)
      const watcher = activeWatchers.get(group.eventKey)!;
      watcher.group = group;
      registerWatcherMarkets(watcher);
    }
  }
  
  // Stop watchers for groups that no longer exist
  const activeKeys = new Set(matchedGroups.map(g => g.eventKey));
  for (const eventKey of [...activeWatchers.keys()]) {
    if (!activeKeys.has(eventKey)) {
      const watcher = activeWatchers.get(eventKey);
      // Keep watching for a bit after group disappears
      if (watcher && Date.now() - watcher.startedAt > 5 * 60 * 1000) {
        stopWatcher(eventKey, 'group_removed');
      }
    }
  }
}

/**
 * Get info about all active watchers
 */
export function getActiveWatchers(): EventWatcherInfo[] {
  return Array.from(activeWatchers.values()).map(w => ({
    eventKey: w.group.eventKey,
    state: w.state,
    startedAt: w.startedAt,
    lastPriceUpdateAt: w.lastPriceUpdateAt,
    lastArbCheckAt: w.lastArbCheckAt,
    arbCheckCount: w.arbCheckCount,
    opportunitiesFound: w.opportunitiesFound,
    lastOpportunity: w.lastOpportunity,
    platforms: Object.keys(w.group.vendors) as LiveEventPlatform[],
    marketCount: {
      SXBET: w.group.vendors.SXBET?.length || 0,
      POLYMARKET: w.group.vendors.POLYMARKET?.length || 0,
      KALSHI: w.group.vendors.KALSHI?.length || 0,
    },
  }));
}

/**
 * Get watcher statistics with timing info
 */
export function getWatcherStats(): {
  activeWatchers: number;
  totalArbChecks: number;
  totalOpportunities: number;
  avgChecksPerSecond: number;
  avgCheckTimeMs: number;
  maxCheckTimeMs: number;
  totalMarketsWatched: number;
} {
  let totalChecks = 0;
  let totalOpps = 0;
  let totalRuntime = 0;
  let totalCheckTime = 0;
  let maxCheckTime = 0;
  let totalMarkets = 0;
  const now = Date.now();
  
  for (const w of activeWatchers.values()) {
    totalChecks += w.arbCheckCount;
    totalOpps += w.opportunitiesFound;
    totalRuntime += now - w.startedAt;
    totalCheckTime += w.timing.totalCheckTimeMs;
    maxCheckTime = Math.max(maxCheckTime, w.timing.maxCheckTimeMs);
    totalMarkets += w.marketIdToEventKey.size;
  }
  
  const avgRuntime = activeWatchers.size > 0 
    ? totalRuntime / activeWatchers.size 
    : 0;
  const avgChecksPerSecond = avgRuntime > 0 
    ? (totalChecks / activeWatchers.size) / (avgRuntime / 1000) 
    : 0;
  const avgCheckTimeMs = totalChecks > 0
    ? totalCheckTime / totalChecks
    : 0;
  
  return {
    activeWatchers: activeWatchers.size,
    totalArbChecks: totalChecks,
    totalOpportunities: totalOpps,
    avgChecksPerSecond,
    avgCheckTimeMs,
    maxCheckTimeMs: maxCheckTime,
    totalMarketsWatched: totalMarkets,
  };
}

/**
 * Pause all watchers
 */
export function pauseAllWatchers(): void {
  for (const watcher of activeWatchers.values()) {
    if (watcher.fallbackTimer) {
      clearInterval(watcher.fallbackTimer);
      watcher.fallbackTimer = undefined;
    }
    if (watcher.debounceTimer) {
      clearTimeout(watcher.debounceTimer);
      watcher.debounceTimer = undefined;
    }
    watcher.state = 'PAUSED';
  }
  watcherInfo('All watchers paused');
}

/**
 * Resume all watchers
 */
export function resumeAllWatchers(): void {
  for (const watcher of activeWatchers.values()) {
    if (watcher.state === 'PAUSED') {
      watcher.state = 'ACTIVE';
      watcher.fallbackTimer = setInterval(() => {
        const now = Date.now();
        if (!watcher.lastArbCheckAt || now - watcher.lastArbCheckAt > FALLBACK_POLL_INTERVAL_MS / 2) {
          runArbCheck(watcher.group.eventKey);
        }
      }, FALLBACK_POLL_INTERVAL_MS);
    }
  }
  watcherInfo('All watchers resumed');
}

/**
 * Log watcher state
 */
export function logWatcherState(): void {
  const stats = getWatcherStats();
  watcherInfo('Watcher state snapshot', stats);
}
