/**
 * Live Sports Orchestrator
 *
 * Main entry point for the rule-based live sports matcher system.
 * Coordinates:
 * - LiveEventRegistry population
 * - LiveEventMatcher updates
 * - LiveEventWatchers management
 * - Rate limiting for REST calls
 * - Integration with existing bot infrastructure
 *
 * This runs alongside (not replacing) the existing HotMarketTracker system.
 */

import {
  buildLiveEventMatcherConfig,
  LiveEventMatcherConfig,
  LiveEventsApiResponse,
} from '@/types/live-events';
import { Market } from '@/types';
import { getSnapshot, getRegistryStats, runCleanup, logRegistryState } from './live-event-registry';
import { updateMatches, getMatchedEvents, getMatcherStats, logMatcherState } from './live-event-matcher';
import { 
  updateWatchers, 
  getActiveWatchers, 
  getWatcherStats, 
  stopAllWatchers,
  initializeWatchers,
  pauseAllWatchers,
  resumeAllWatchers,
  logWatcherState,
  cleanupWatchers,
} from './live-event-watchers';
import { processAllMarkets } from './live-event-extractors';
import { ExecutionOptions, PlatformAdapters } from './execution-wrapper';
import { getRateLimiterStats, logRateLimiterStatus } from './rate-limiter';

// ============================================================================
// State
// ============================================================================

let isRunning = false;
let config: LiveEventMatcherConfig | null = null;
let registryInterval: NodeJS.Timeout | null = null;
let matcherInterval: NodeJS.Timeout | null = null;
let lastMarketRefreshAt = 0;
let startedAt = 0;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get current configuration (cached)
 */
export function getConfig(): LiveEventMatcherConfig {
  if (!config) {
    config = buildLiveEventMatcherConfig();
  }
  return config;
}

/**
 * Refresh configuration from environment
 */
export function refreshConfig(): LiveEventMatcherConfig {
  config = buildLiveEventMatcherConfig();
  return config;
}

/**
 * Check if the orchestrator is enabled
 */
export function isLiveSportsMatcherEnabled(): boolean {
  return getConfig().enabled;
}

/**
 * Log current configuration
 */
function logConfig(): void {
  const c = getConfig();
  console.log('[LiveSportsOrchestrator] Configuration:');
  console.log(`  enabled: ${c.enabled}`);
  console.log(`  sportsOnly: ${c.sportsOnly}`);
  console.log(`  timeTolerance: ${c.timeTolerance / 60000} minutes`);
  console.log(`  minTeamSimilarity: ${c.minTeamSimilarity}`);
  console.log(`  maxWatchers: ${c.maxWatchers}`);
  console.log(`  minPlatforms: ${c.minPlatforms}`);
  console.log(`  registryRefreshInterval: ${c.registryRefreshInterval / 1000}s`);
  console.log(`  matcherInterval: ${c.matcherInterval / 1000}s`);
  console.log(`  preGameWindow: ${c.preGameWindow / 60000} minutes`);
  console.log(`  postGameWindow: ${c.postGameWindow / 60000} minutes`);
}

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Start the live sports orchestrator
 */
export async function startOrchestrator(
  adapters: PlatformAdapters,
  executionOptions: Partial<ExecutionOptions>
): Promise<boolean> {
  config = buildLiveEventMatcherConfig();

  if (!config.enabled) {
    console.log('[LiveSportsOrchestrator] Not enabled (set LIVE_RULE_BASED_MATCHER_ENABLED=true)');
    return false;
  }

  if (isRunning) {
    console.log('[LiveSportsOrchestrator] Already running');
    return true;
  }

  console.log('[LiveSportsOrchestrator] Starting...');
  logConfig();

  // Initialize watchers with adapters
  initializeWatchers(adapters, executionOptions);

  // Start periodic registry cleanup
  registryInterval = setInterval(() => {
    runCleanup();
  }, config.registryRefreshInterval);

  // Start periodic matcher updates
  matcherInterval = setInterval(() => {
    runMatcherCycle();
  }, config.matcherInterval);

  isRunning = true;
  startedAt = Date.now();
  
  console.log('[LiveSportsOrchestrator] Started successfully');
  return true;
}

/**
 * Stop the live sports orchestrator
 */
export function stopOrchestrator(): void {
  if (!isRunning) return;

  console.log('[LiveSportsOrchestrator] Stopping...');

  // Stop intervals
  if (registryInterval) {
    clearInterval(registryInterval);
    registryInterval = null;
  }

  if (matcherInterval) {
    clearInterval(matcherInterval);
    matcherInterval = null;
  }

  // Cleanup watchers (unregisters price listeners)
  cleanupWatchers();

  isRunning = false;
  console.log('[LiveSportsOrchestrator] Stopped');
}

/**
 * Pause the orchestrator (stop watchers but keep registry/matcher running)
 */
export function pauseOrchestrator(): void {
  pauseAllWatchers();
  console.log('[LiveSportsOrchestrator] Paused');
}

/**
 * Resume the orchestrator
 */
export function resumeOrchestrator(): void {
  resumeAllWatchers();
  console.log('[LiveSportsOrchestrator] Resumed');
}

// ============================================================================
// Core Loop
// ============================================================================

/**
 * Refresh the registry with current market data
 */
export async function refreshRegistry(markets?: Market[]): Promise<void> {
  if (!config) config = getConfig();

  try {
    if (markets && markets.length > 0) {
      // Filter for sports if configured
      let filteredMarkets = markets;
      if (config.sportsOnly) {
        filteredMarkets = markets.filter(m => 
          m.marketType === 'sportsbook' ||
          /\b(vs|@|versus)\b/i.test(m.title)
        );
      }

      // Process markets into registry
      const result = processAllMarkets(filteredMarkets);
      console.log(
        `[LiveSportsOrchestrator] Processed ${result.total} events: ` +
        `SX.bet=${result.sxbet}, Polymarket=${result.polymarket}, Kalshi=${result.kalshi}`
      );
      lastMarketRefreshAt = Date.now();
    }

    // Run cleanup of stale events
    runCleanup();

  } catch (error) {
    console.error('[LiveSportsOrchestrator] Error refreshing registry:', error);
  }
}

/**
 * Run a single matcher cycle
 */
export function runMatcherCycle(): void {
  if (!config) config = getConfig();

  try {
    // Get registry snapshot
    const snapshot = getSnapshot();

    // Update matches
    updateMatches(snapshot);

    // Update watchers based on matches
    updateWatchers();

  } catch (error) {
    console.error('[LiveSportsOrchestrator] Error in matcher cycle:', error);
  }
}

/**
 * Force a full refresh and match cycle
 */
export async function forceFullRefresh(markets: Market[]): Promise<void> {
  await refreshRegistry(markets);
  runMatcherCycle();
}

// ============================================================================
// Integration with Bot
// ============================================================================

/**
 * Called when the bot fetches new markets
 * This populates the registry with the latest data
 */
export function onMarketsUpdated(markets: Market[]): void {
  if (!isRunning) return;

  refreshRegistry(markets);
}

/**
 * Called on WebSocket price updates
 */
export function onLivePriceUpdate(platform: string, marketId: string): void {
  // The watchers handle this internally via LivePriceCache listener
  // This hook is for future enhancements or logging
}

// ============================================================================
// API / Status
// ============================================================================

/**
 * Get comprehensive status for API
 */
export function getOrchestratorStatus(): LiveEventsApiResponse & {
  running: boolean;
  uptimeMs: number;
  rateLimiterStats: ReturnType<typeof getRateLimiterStats>;
} {
  const cfg = getConfig();
  const registrySnapshot = getSnapshot();
  const matchedGroups = getMatchedEvents();
  const watchers = getActiveWatchers();
  const registryStats = getRegistryStats();
  const watcherStats = getWatcherStats();
  const rateLimiterStats = getRateLimiterStats();

  return {
    enabled: cfg.enabled,
    running: isRunning,
    uptimeMs: isRunning ? Date.now() - startedAt : 0,
    config: cfg,
    registry: registrySnapshot,
    matchedGroups,
    watchers,
    stats: {
      totalVendorEvents: registryStats.totalEvents,
      liveEvents: registryStats.byStatus.LIVE,
      preEvents: registryStats.byStatus.PRE,
      matchedGroups: matchedGroups.length,
      activeWatchers: watcherStats.activeWatchers,
      arbChecksTotal: watcherStats.totalArbChecks,
      opportunitiesTotal: watcherStats.totalOpportunities,
    },
    rateLimiterStats,
    generatedAt: Date.now(),
  };
}

/**
 * Check if the orchestrator is running
 */
export function isOrchestratorRunning(): boolean {
  return isRunning;
}

/**
 * Get uptime in milliseconds
 */
export function getUptimeMs(): number {
  return isRunning ? Date.now() - startedAt : 0;
}

/**
 * Log current state
 */
export function logOrchestratorState(): void {
  console.log('\n=== Live Sports Orchestrator State ===');
  console.log(`Running: ${isRunning}`);
  const uptimeSeconds = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`Uptime: ${isRunning ? `${uptimeSeconds}s` : 'N/A'}`);
  console.log(`Last market refresh: ${lastMarketRefreshAt ? new Date(lastMarketRefreshAt).toISOString() : 'never'}`);
  
  logRegistryState();
  logMatcherState();
  logWatcherState();
  logRateLimiterStatus();
  
  console.log('=======================================\n');
}

// ============================================================================
// Export config for external use
// ============================================================================

export { buildLiveEventMatcherConfig } from '@/types/live-events';
