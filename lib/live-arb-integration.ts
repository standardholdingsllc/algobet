/**
 * Live Arb Integration
 *
 * Provides integration hooks for the bot to initialize and use
 * live-event arbitrage alongside the existing snapshot pipeline.
 *
 * SAFETY CHECK ARCHITECTURE:
 * ==========================
 * This module integrates live arb safety checks with the existing risk logic:
 *
 * 1. EXISTING RISK CHECKS (in bot.ts):
 *    - validateOpportunity() - profit margin validation
 *    - Expiry window checks (maxDaysToExpiry)
 *    - Bet size limits (maxBetPercentage)
 *    - Balance checks (per-platform cash availability)
 *
 * 2. LIVE ARB SAFETY CHECKS (in live-arb-safety.ts):
 *    - Price staleness (maxPriceAgeMs)
 *    - Slippage risk estimation
 *    - Circuit breaker (consecutive failures)
 *    - Liquidity checks
 *    - Data consistency / platform skew detection
 *
 * When executing a live opportunity:
 *    - Live safety checks run FIRST (fail fast on stale data)
 *    - Then standard risk checks apply
 *    - Both must pass for execution
 *
 * Usage in bot.ts:
 * ```
 * import { initializeLiveArb, shutdownLiveArb, checkLiveArbSafety } from './live-arb-integration';
 *
 * // In bot startup:
 * await initializeLiveArb(config, hotMarketTracker);
 *
 * // Before executing a live opportunity:
 * const safetyResult = checkLiveArbSafety(liveOpp);
 * if (!safetyResult.overallPassed) {
 *   console.log('Blocked:', safetyResult.blockers);
 *   return;
 * }
 * // Then proceed with existing execution (bet sizes, validation, etc.)
 *
 * // In bot shutdown:
 * await shutdownLiveArb();
 * ```
 */

import { LiveArbManager } from './live-arb-manager';
import { LivePriceCache } from './live-price-cache';
import {
  getLiveArbSafetyChecker,
  LiveArbSafetyChecker,
  ComprehensiveSafetyCheck,
} from './live-arb-safety';
import { HotMarketTracker } from './hot-market-tracker';
import {
  LiveArbConfig,
  LiveArbOpportunity,
  LiveArbRuntimeConfig,
  DEFAULT_LIVE_ARB_CONFIG,
} from '@/types/live-arb';
import { BotConfig, Market, MarketPlatform, TrackedMarket, ArbitrageOpportunity } from '@/types';
import { scanArbitrageOpportunities, validateOpportunity } from './arbitrage';
import { loadLiveArbRuntimeConfig } from './live-arb-runtime-config';

// ============================================================================
// Configuration Helpers
// ============================================================================

/**
 * Build LiveArbConfig from BotConfig + KV runtime config.
 * Environment variables remain optional tuning knobs.
 */
export function buildLiveArbConfig(
  botConfig: BotConfig,
  runtimeConfig: LiveArbRuntimeConfig
): LiveArbConfig {
  const envMinProfitBps = parseInt(process.env.LIVE_ARB_MIN_PROFIT_BPS || '50', 10);
  const envMaxLatencyMs = parseInt(process.env.LIVE_ARB_MAX_LATENCY_MS || '2000', 10);
  const envMaxPriceAgeMs = parseInt(process.env.LIVE_ARB_MAX_PRICE_AGE_MS || '2000', 10);

  return {
    enabled: runtimeConfig.liveArbEnabled,
    minProfitBps: envMinProfitBps,
    maxExecutionLatencyMs: envMaxLatencyMs,
    maxPriceAgeMs: envMaxPriceAgeMs,
    liveEventsOnly: runtimeConfig.liveEventsOnly,
    maxSlippageBps: 100,
    enabledPlatforms: ['kalshi', 'polymarket', 'sxbet'],
  };
}

// ============================================================================
// Initialization & Shutdown
// ============================================================================

/**
 * Initialize the live arb system.
 * Call this during bot startup if live arb is enabled.
 *
 * @param botConfig Current bot configuration
 * @param hotMarketTracker Reference to the HotMarketTracker
 * @returns Whether initialization succeeded
 */
export async function initializeLiveArb(
  botConfig: BotConfig,
  hotMarketTracker?: HotMarketTracker
): Promise<boolean> {
  const runtimeConfig = await loadLiveArbRuntimeConfig();
  const config = buildLiveArbConfig(botConfig, runtimeConfig);

  if (!runtimeConfig.liveArbEnabled) {
    console.log('[LiveArbIntegration] Live arb disabled by runtime config; enable it from the dashboard.');
    return false;
  }

  try {
    console.log('[LiveArbIntegration] Initializing live arb system...');

    // Initialize the manager
    await LiveArbManager.initialize(config, hotMarketTracker);

    // Initialize safety checker
    getLiveArbSafetyChecker({
      maxPriceAgeMs: config.maxPriceAgeMs,
      maxSlippageBps: config.maxSlippageBps,
      minProfitBps: config.minProfitBps,
    });

    // Set up opportunity handler
    LiveArbManager.onArbOpportunity((opp) => {
      handleLiveOpportunity(opp);
    });

    console.log('[LiveArbIntegration] ✅ Live arb system initialized');
    return true;
  } catch (error) {
    console.error('[LiveArbIntegration] Failed to initialize:', error);
    return false;
  }
}

/**
 * Shutdown the live arb system.
 * Call this during bot shutdown.
 */
export async function shutdownLiveArb(): Promise<void> {
  console.log('[LiveArbIntegration] Shutting down live arb system...');
  await LiveArbManager.shutdown();
}

// ============================================================================
// Scan Integration
// ============================================================================

/**
 * Subscribe tracked markets to WebSocket feeds.
 * Call this after HotMarketTracker is populated.
 */
export function subscribeTrackedMarketsToWs(trackedMarkets: TrackedMarket[]): void {
  if (!LiveArbManager.isReady()) {
    return;
  }

  LiveArbManager.subscribeToTrackedMarkets(trackedMarkets);
}

/**
 * Augment snapshot markets with live prices.
 * Call this during the scan loop to get real-time prices.
 *
 * @param snapshotMarkets Markets from snapshot
 * @param maxPriceAgeMs Maximum age of live prices to use
 * @returns Markets with live prices overlaid where available
 */
export function augmentWithLivePrices(
  snapshotMarkets: Record<MarketPlatform, Market[]>,
  maxPriceAgeMs: number = 2000
): {
  markets: Record<MarketPlatform, Market[]>;
  stats: {
    totalMarkets: number;
    liveUpdated: number;
    byPlatform: Record<MarketPlatform, { total: number; live: number }>;
  };
} {
  const result: Record<MarketPlatform, Market[]> = {
    kalshi: [],
    polymarket: [],
    sxbet: [],
  };

  const stats = {
    totalMarkets: 0,
    liveUpdated: 0,
    byPlatform: {
      kalshi: { total: 0, live: 0 },
      polymarket: { total: 0, live: 0 },
      sxbet: { total: 0, live: 0 },
    } as Record<MarketPlatform, { total: number; live: number }>,
  };

  for (const platform of Object.keys(snapshotMarkets) as MarketPlatform[]) {
    const markets = snapshotMarkets[platform];
    stats.byPlatform[platform].total = markets.length;
    stats.totalMarkets += markets.length;

    for (const market of markets) {
      const livePrices = LivePriceCache.getEffectiveMarketPrices(
        market,
        maxPriceAgeMs
      );

      const hasLive =
        livePrices.yesSource === 'live' || livePrices.noSource === 'live';

      if (hasLive) {
        stats.liveUpdated++;
        stats.byPlatform[platform].live++;

        result[platform].push({
          ...market,
          yesPrice: livePrices.yesPrice,
          noPrice: livePrices.noPrice,
        });
      } else {
        result[platform].push(market);
      }
    }
  }

  return { markets: result, stats };
}

/**
 * Run arbitrage scan with live prices.
 * This wraps the existing scanArbitrageOpportunities with live price overlay.
 *
 * @param snapshotMarkets Markets from snapshots
 * @param minProfitMargin Minimum profit margin (%)
 * @param useLivePrices Whether to overlay live prices
 * @returns Arbitrage opportunities (may include LiveArbOpportunity if from live data)
 */
export function scanWithLivePrices(
  snapshotMarkets: Record<MarketPlatform, Market[]>,
  minProfitMargin: number,
  useLivePrices: boolean = true
): {
  opportunities: LiveArbOpportunity[];
  scanStats: {
    usedLivePrices: boolean;
    liveMarketsCount: number;
  };
} {
  let markets = snapshotMarkets;
  let liveMarketsCount = 0;

  if (useLivePrices && LiveArbManager.isReady()) {
    const augmented = augmentWithLivePrices(snapshotMarkets);
    markets = augmented.markets;
    liveMarketsCount = augmented.stats.liveUpdated;
  }

  // Gather all markets for cross-platform scan
  const allMarkets = [
    ...markets.kalshi,
    ...markets.polymarket,
    ...markets.sxbet,
  ];

  // Run existing arb scan
  const result = scanArbitrageOpportunities(
    allMarkets.filter((m) => m.platform === 'kalshi'),
    allMarkets.filter((m) => m.platform !== 'kalshi'),
    minProfitMargin,
    { label: 'live-augmented', silent: false }
  );

  // Convert to LiveArbOpportunity format
  const liveOpportunities: LiveArbOpportunity[] = result.opportunities.map(
    (opp) => ({
      ...opp,
      detectedAt: new Date().toISOString(),
      maxPriceAgeMs: 0, // Will be filled if we have live data
      hasLiveScoreContext: false,
      priceSource: {
        market1: 'snapshot',
        market2: 'snapshot',
      },
    })
  );

  return {
    opportunities: liveOpportunities,
    scanStats: {
      usedLivePrices: useLivePrices && LiveArbManager.isReady(),
      liveMarketsCount,
    },
  };
}

// ============================================================================
// Safety Check Integration
// ============================================================================

/**
 * Check if a live opportunity passes all safety checks.
 * Call this BEFORE executing a live opportunity.
 *
 * This runs live-specific checks (price staleness, slippage, circuit breaker)
 * and should be combined with existing risk checks (expiry window, bet limits).
 *
 * @param opp The live opportunity to check
 * @param minProfitMargin Optional profit margin override (uses config default)
 * @returns Safety check result with blockers and warnings
 */
export function checkLiveArbSafety(
  opp: LiveArbOpportunity,
  minProfitMargin?: number
): ComprehensiveSafetyCheck {
  const safetyChecker = getLiveArbSafetyChecker();
  const result = safetyChecker.checkOpportunity(opp);

  // Also validate the underlying arbitrage (existing logic)
  if (minProfitMargin !== undefined) {
    const isValidArb = validateOpportunity(opp, minProfitMargin);
    if (!isValidArb) {
      result.overallPassed = false;
      result.blockers.push('profitValidation: Profit margin no longer valid');
    }
  }

  return result;
}

/**
 * Record execution result for circuit breaker tracking.
 * Call this AFTER attempting to execute a live opportunity.
 *
 * @param success Whether the execution succeeded
 * @param error Optional error message if failed
 */
export function recordLiveExecutionResult(
  success: boolean,
  error?: string
): void {
  const safetyChecker = getLiveArbSafetyChecker();
  safetyChecker.recordExecutionResult(success, error);

  // Also record in manager for stats
  if (!success && error) {
    LiveArbManager.recordBlockedOpportunity(error);
  }
}

/**
 * Manually trip the circuit breaker (emergency stop).
 * Use this when you detect critical issues that should halt all live execution.
 *
 * @param reason Description of why the circuit was tripped
 */
export function tripLiveArbCircuitBreaker(reason: string): void {
  const safetyChecker = getLiveArbSafetyChecker();
  safetyChecker.tripCircuit(reason);
  console.warn(`[LiveArbIntegration] ⚠️ Circuit breaker TRIPPED: ${reason}`);
}

/**
 * Check if the live arb circuit breaker is open.
 * When open, no live executions should be attempted.
 */
export function isLiveArbCircuitOpen(): boolean {
  const safetyChecker = getLiveArbSafetyChecker();
  return safetyChecker.isCircuitOpen();
}

// ============================================================================
// Opportunity Handling
// ============================================================================

// Registered execution handler (set by bot or external code)
let executionHandler: ((opp: LiveArbOpportunity) => Promise<boolean>) | null = null;

/**
 * Register a handler to execute live opportunities.
 * The handler should return true if execution succeeded.
 *
 * Example:
 * ```
 * registerLiveExecutionHandler(async (opp) => {
 *   // Your execution logic here
 *   const result = await executeLiveOpportunity(opp);
 *   return result.success;
 * });
 * ```
 */
export function registerLiveExecutionHandler(
  handler: (opp: LiveArbOpportunity) => Promise<boolean>
): void {
  executionHandler = handler;
  console.log('[LiveArbIntegration] Execution handler registered');
}

/**
 * Default handler for live opportunities.
 * Override this by setting your own handler via registerLiveExecutionHandler()
 * or LiveArbManager.onArbOpportunity()
 */
async function handleLiveOpportunity(opp: LiveArbOpportunity): Promise<void> {
  const logLevel = process.env.LIVE_ARB_LOG_LEVEL || 'info';

  // Run safety checks
  const safetyResult = checkLiveArbSafety(opp);

  if (!safetyResult.overallPassed) {
    const blockerStr = safetyResult.blockers.join(', ');
    console.log(
      `[LiveArbIntegration] Opportunity blocked: ${blockerStr}`
    );

    // Detailed logging at debug level
    if (logLevel === 'debug') {
      console.debug('[LiveArbIntegration] Blocked opportunity details:', {
        market1: opp.market1.title,
        market2: opp.market2.title,
        profit: opp.profitMargin.toFixed(2) + '%',
        maxPriceAgeMs: opp.maxPriceAgeMs,
        checks: safetyResult.checks,
      });
    }

    // Record blocked for stats
    for (const blocker of safetyResult.blockers) {
      const checkName = blocker.split(':')[0] || 'unknown';
      LiveArbManager.recordBlockedOpportunity(checkName);
    }
    return;
  }

  // Log warnings
  if (safetyResult.warnings.length > 0) {
    console.warn(
      `[LiveArbIntegration] Opportunity warnings: ${safetyResult.warnings.join(', ')}`
    );
  }

  // Log the valid opportunity
  console.log(
    `[LiveArbIntegration] 🎯 Valid live opportunity: ` +
      `${opp.market1.title} (${opp.market1.platform}) vs ` +
      `${opp.market2.title} (${opp.market2.platform}) - ` +
      `${opp.profitMargin.toFixed(2)}% profit`
  );

  // Execute if we have a handler
  if (executionHandler) {
    try {
      const success = await executionHandler(opp);
      recordLiveExecutionResult(success, success ? undefined : 'Execution failed');
    } catch (error: any) {
      console.error('[LiveArbIntegration] Execution handler error:', error);
      recordLiveExecutionResult(false, error.message || 'Unknown error');
    }
  } else {
    if (logLevel === 'debug') {
      console.debug('[LiveArbIntegration] No execution handler registered - logging only');
    }
  }
}

// ============================================================================
// Status & Monitoring
// ============================================================================

/**
 * Get comprehensive status of the live arb system
 */
export function getLiveArbStatus(): {
  enabled: boolean;
  ready: boolean;
  managerStatus: ReturnType<typeof LiveArbManager.getStatus>;
  safetyStatus: {
    circuitBreakerOpen: boolean;
    circuitBreakerState: ReturnType<LiveArbSafetyChecker['getCircuitBreakerState']>;
  };
  cacheStats: ReturnType<typeof LivePriceCache.getStats>;
} {
  const safetyChecker = getLiveArbSafetyChecker();

  return {
    enabled: LiveArbManager.getConfig().enabled,
    ready: LiveArbManager.isReady(),
    managerStatus: LiveArbManager.getStatus(),
    safetyStatus: {
      circuitBreakerOpen: safetyChecker.isCircuitOpen(),
      circuitBreakerState: safetyChecker.getCircuitBreakerState(),
    },
    cacheStats: LivePriceCache.getStats(),
  };
}

/**
 * Check if live arb is active and ready
 */
export function isLiveArbActive(): boolean {
  return LiveArbManager.isReady();
}

// ============================================================================
// Filter Helpers
// ============================================================================

/**
 * Filter markets to only include live/in-play events.
 * Uses SX.bet notion of "live" and time-based heuristics for others.
 */
export function filterLiveEvents(
  markets: Market[],
  hotMarketTracker?: HotMarketTracker
): Market[] {
  const now = Date.now();
  const oneHourMs = 3600000;
  const threeHoursMs = 3 * oneHourMs;

  return markets.filter((market) => {
    const expiryMs = new Date(market.expiryDate).getTime();

    if (market.marketType === 'sportsbook') {
      // For sportsbook markets, "live" means expiring within 3 hours
      // or has active score data
      const score = LivePriceCache.getScore(market.id);
      if (score && score.gamePhase === 'live') {
        return true;
      }
      return expiryMs - now < threeHoursMs && expiryMs > now;
    } else {
      // For prediction markets, "live" means expiring within 1 hour
      return expiryMs - now < oneHourMs && expiryMs > now;
    }
  });
}

