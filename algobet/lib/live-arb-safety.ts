/**
 * Live Arb Safety Module
 *
 * Provides circuit breakers and safety checks for live-event arbitrage.
 * Designed to integrate with existing risk management in lib/fees.ts
 * and the execution gates in lib/bot.ts.
 */

import {
  CircuitBreakerState,
  CircuitBreakerConfig,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  LiveArbOpportunity,
} from '@/types/live-arb';
import { Market, ArbitrageOpportunity } from '@/types';

// ============================================================================
// Safety Check Results
// ============================================================================

export interface SafetyCheckResult {
  passed: boolean;
  reason?: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface ComprehensiveSafetyCheck {
  overallPassed: boolean;
  checks: {
    priceAge: SafetyCheckResult;
    slippage: SafetyCheckResult;
    circuitBreaker: SafetyCheckResult;
    liquidity: SafetyCheckResult;
    profitMargin: SafetyCheckResult;
    dataConsistency: SafetyCheckResult;
  };
  blockers: string[];
  warnings: string[];
}

// ============================================================================
// Safety Configuration
// ============================================================================

export interface LiveArbSafetyConfig {
  /** Maximum age of price data to execute on (ms) */
  maxPriceAgeMs: number;

  /** Maximum acceptable slippage from quoted to execution (basis points) */
  maxSlippageBps: number;

  /** Minimum profit margin to execute (basis points) */
  minProfitBps: number;

  /** Minimum liquidity required at execution price */
  minLiquidityUsd: number;

  /** Maximum skew between platforms before halting (percentage points) */
  maxPlatformSkewPct: number;

  /** Time window to detect sustained skew (ms) */
  skewWindowMs: number;

  /** Enable data consistency checks */
  enableConsistencyChecks: boolean;
}

/**
 * Build default safety config from environment variables.
 * All thresholds can be overridden via env vars.
 */
function buildDefaultSafetyConfig(): LiveArbSafetyConfig {
  return {
    maxPriceAgeMs: parseInt(process.env.LIVE_ARB_MAX_PRICE_AGE_MS || '2000', 10),
    maxSlippageBps: parseInt(process.env.LIVE_ARB_MAX_SLIPPAGE_BPS || '100', 10), // 1%
    minProfitBps: parseInt(process.env.LIVE_ARB_MIN_PROFIT_BPS || '25', 10), // 0.25%
    minLiquidityUsd: parseFloat(process.env.LIVE_ARB_MIN_LIQUIDITY_USD || '10'),
    maxPlatformSkewPct: parseFloat(process.env.LIVE_ARB_MAX_SKEW_PCT || '20'),
    skewWindowMs: parseInt(process.env.LIVE_ARB_SKEW_WINDOW_MS || '30000', 10),
    enableConsistencyChecks: true,
  };
}

export const DEFAULT_SAFETY_CONFIG: LiveArbSafetyConfig = buildDefaultSafetyConfig();

// ============================================================================
// Live Arb Safety Checker
// ============================================================================

// ============================================================================
// Statistics for Monitoring
// ============================================================================

interface SafetyStats {
  checksPerformed: number;
  checksPassed: number;
  checksFailed: number;
  failuresByReason: Record<string, number>;
  lastCheckAt?: string;
  lastBlockedOpportunity?: {
    market1: string;
    market2: string;
    reason: string;
    timestamp: string;
  };
}

// Log level from environment
const LOG_LEVEL = process.env.LIVE_ARB_LOG_LEVEL || 'info';
const DEBUG_ENABLED = LOG_LEVEL === 'debug';

export class LiveArbSafetyChecker {
  private config: LiveArbSafetyConfig;
  private circuitBreakerConfig: CircuitBreakerConfig;
  private circuitBreakerState: CircuitBreakerState;

  // Track platform skew history for sustained skew detection
  private skewHistory: Array<{
    timestamp: number;
    skewPct: number;
    platforms: [string, string];
  }> = [];

  // Track execution results for circuit breaker
  private recentResults: Array<{
    timestamp: number;
    success: boolean;
    error?: string;
  }> = [];

  // Statistics for monitoring
  private stats: SafetyStats = {
    checksPerformed: 0,
    checksPassed: 0,
    checksFailed: 0,
    failuresByReason: {},
  };

  constructor(
    config?: Partial<LiveArbSafetyConfig>,
    cbConfig?: Partial<CircuitBreakerConfig>
  ) {
    this.config = { ...DEFAULT_SAFETY_CONFIG, ...config };
    this.circuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...cbConfig };
    this.circuitBreakerState = {
      isOpen: false,
      consecutiveFailures: 0,
    };

    // Log configuration at startup
    this.logConfig();
  }

  /**
   * Log the current safety configuration
   */
  private logConfig(): void {
    console.log('[LiveArbSafety] Configuration:');
    console.log(`  maxPriceAgeMs: ${this.config.maxPriceAgeMs}ms`);
    console.log(`  maxSlippageBps: ${this.config.maxSlippageBps} bps (${this.config.maxSlippageBps / 100}%)`);
    console.log(`  minProfitBps: ${this.config.minProfitBps} bps (${this.config.minProfitBps / 100}%)`);
    console.log(`  minLiquidityUsd: $${this.config.minLiquidityUsd}`);
    console.log(`  maxPlatformSkewPct: ${this.config.maxPlatformSkewPct}%`);
    console.log(`  consistencyChecks: ${this.config.enableConsistencyChecks}`);
    console.log(`  logLevel: ${LOG_LEVEL}`);
  }

  // --------------------------------------------------------------------------
  // Main Safety Check Entry Point
  // --------------------------------------------------------------------------

  /**
   * Run all safety checks on a live arb opportunity.
   * Returns a comprehensive result indicating if execution should proceed.
   */
  checkOpportunity(opp: LiveArbOpportunity): ComprehensiveSafetyCheck {
    this.stats.checksPerformed++;
    this.stats.lastCheckAt = new Date().toISOString();

    const checks = {
      priceAge: this.checkPriceAge(opp),
      slippage: this.checkSlippage(opp),
      circuitBreaker: this.checkCircuitBreaker(),
      liquidity: this.checkLiquidity(opp),
      profitMargin: this.checkProfitMargin(opp),
      dataConsistency: this.checkDataConsistency(opp),
    };

    const blockers: string[] = [];
    const warnings: string[] = [];

    for (const [name, result] of Object.entries(checks)) {
      if (!result.passed) {
        if (result.severity === 'critical') {
          blockers.push(`${name}: ${result.reason}`);
          // Track failure reasons
          this.stats.failuresByReason[name] = (this.stats.failuresByReason[name] || 0) + 1;
        } else if (result.severity === 'warning') {
          warnings.push(`${name}: ${result.reason}`);
        }
      }
    }

    const passed = blockers.length === 0;

    if (passed) {
      this.stats.checksPassed++;
    } else {
      this.stats.checksFailed++;

      // Store last blocked opportunity for debugging
      this.stats.lastBlockedOpportunity = {
        market1: `${opp.market1.platform}:${opp.market1.id.substring(0, 16)}`,
        market2: `${opp.market2.platform}:${opp.market2.id.substring(0, 16)}`,
        reason: blockers.join('; '),
        timestamp: new Date().toISOString(),
      };

      // Structured logging for blocked opportunities
      this.logBlockedOpportunity(opp, blockers, checks);
    }

    // Log warnings even for passed opportunities
    if (warnings.length > 0 && DEBUG_ENABLED) {
      console.warn(
        `[LiveArbSafety] Opportunity passed with warnings:`,
        warnings.join(', ')
      );
    }

    return {
      overallPassed: passed,
      checks,
      blockers,
      warnings,
    };
  }

  /**
   * Log a blocked opportunity with structured data
   */
  private logBlockedOpportunity(
    opp: LiveArbOpportunity,
    blockers: string[],
    checks: Record<string, SafetyCheckResult>
  ): void {
    const logData = {
      market1: {
        platform: opp.market1.platform,
        id: opp.market1.id.substring(0, 20),
        title: opp.market1.title.substring(0, 50),
      },
      market2: {
        platform: opp.market2.platform,
        id: opp.market2.id.substring(0, 20),
        title: opp.market2.title.substring(0, 50),
      },
      profitMargin: opp.profitMargin.toFixed(2) + '%',
      priceAgeMs: opp.maxPriceAgeMs,
      blockers,
    };

    if (DEBUG_ENABLED) {
      // Detailed debug logging
      console.log('[LiveArbSafety] BLOCKED:', JSON.stringify(logData, null, 2));
      console.log('[LiveArbSafety] Check details:', {
        priceAge: checks.priceAge,
        slippage: checks.slippage,
        circuitBreaker: checks.circuitBreaker,
        profitMargin: checks.profitMargin,
      });
    } else {
      // Compact info logging
      console.log(
        `[LiveArbSafety] BLOCKED: ${opp.market1.platform} vs ${opp.market2.platform} ` +
        `(${opp.profitMargin.toFixed(2)}%) - ${blockers.join(', ')}`
      );
    }
  }

  /**
   * Get safety check statistics
   */
  getStats(): SafetyStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      checksPerformed: 0,
      checksPassed: 0,
      checksFailed: 0,
      failuresByReason: {},
    };
  }

  // --------------------------------------------------------------------------
  // Individual Safety Checks
  // --------------------------------------------------------------------------

  /**
   * Check if price data is fresh enough
   */
  checkPriceAge(opp: LiveArbOpportunity): SafetyCheckResult {
    if (opp.maxPriceAgeMs > this.config.maxPriceAgeMs) {
      return {
        passed: false,
        reason: `Price data too stale: ${opp.maxPriceAgeMs}ms > ${this.config.maxPriceAgeMs}ms limit`,
        severity: 'critical',
      };
    }

    if (opp.maxPriceAgeMs > this.config.maxPriceAgeMs * 0.8) {
      return {
        passed: true,
        reason: `Price data approaching staleness: ${opp.maxPriceAgeMs}ms`,
        severity: 'warning',
      };
    }

    return { passed: true, severity: 'info' };
  }

  /**
   * Check potential slippage risk
   */
  checkSlippage(opp: LiveArbOpportunity): SafetyCheckResult {
    // If we have bid/ask data, check spread
    const spread1 = this.estimateSpread(opp.market1);
    const spread2 = this.estimateSpread(opp.market2);

    const totalSpread = spread1 + spread2;
    const spreadBps = totalSpread * 100; // Convert to bps

    if (spreadBps > this.config.maxSlippageBps) {
      return {
        passed: false,
        reason: `Estimated slippage too high: ${spreadBps.toFixed(0)}bps > ${this.config.maxSlippageBps}bps limit`,
        severity: 'critical',
      };
    }

    if (spreadBps > this.config.maxSlippageBps * 0.7) {
      return {
        passed: true,
        reason: `Slippage risk elevated: ${spreadBps.toFixed(0)}bps`,
        severity: 'warning',
      };
    }

    return { passed: true, severity: 'info' };
  }

  /**
   * Check circuit breaker state
   */
  checkCircuitBreaker(): SafetyCheckResult {
    if (this.circuitBreakerState.isOpen) {
      return {
        passed: false,
        reason: `Circuit breaker open: ${this.circuitBreakerState.openReason}`,
        severity: 'critical',
      };
    }

    if (this.circuitBreakerState.consecutiveFailures > 0) {
      return {
        passed: true,
        reason: `${this.circuitBreakerState.consecutiveFailures} recent failure(s)`,
        severity: 'warning',
      };
    }

    return { passed: true, severity: 'info' };
  }

  /**
   * Check if there's enough liquidity
   */
  checkLiquidity(opp: ArbitrageOpportunity): SafetyCheckResult {
    // Use volume as a proxy for liquidity if available
    const vol1 = opp.market1.volume ?? 0;
    const vol2 = opp.market2.volume ?? 0;

    if (vol1 === 0 && vol2 === 0) {
      return {
        passed: true,
        reason: 'Volume data unavailable, skipping liquidity check',
        severity: 'warning',
      };
    }

    const minVol = Math.min(vol1, vol2);
    if (minVol < this.config.minLiquidityUsd) {
      return {
        passed: false,
        reason: `Insufficient liquidity: $${minVol.toFixed(0)} < $${this.config.minLiquidityUsd}`,
        severity: 'critical',
      };
    }

    return { passed: true, severity: 'info' };
  }

  /**
   * Check minimum profit margin
   */
  checkProfitMargin(opp: ArbitrageOpportunity): SafetyCheckResult {
    const profitBps = opp.profitMargin * 100; // Convert % to bps

    if (profitBps < this.config.minProfitBps) {
      return {
        passed: false,
        reason: `Profit margin too low: ${profitBps.toFixed(0)}bps < ${this.config.minProfitBps}bps minimum`,
        severity: 'critical',
      };
    }

    return { passed: true, severity: 'info' };
  }

  /**
   * Check data consistency across platforms
   */
  checkDataConsistency(opp: LiveArbOpportunity): SafetyCheckResult {
    if (!this.config.enableConsistencyChecks) {
      return { passed: true, severity: 'info' };
    }

    // Check for extreme price divergence (potential data issue)
    const price1 =
      opp.side1 === 'yes' ? opp.market1.yesPrice : opp.market1.noPrice;
    const price2 =
      opp.side2 === 'yes' ? opp.market2.yesPrice : opp.market2.noPrice;

    // Calculate skew (for binary markets, combined price should be near 100)
    const combinedImplied = this.getCombinedImplied(opp);
    const skewPct = Math.abs(100 - combinedImplied);

    // Record skew for sustained detection
    this.recordSkew(skewPct, opp.market1.platform, opp.market2.platform);

    if (skewPct > this.config.maxPlatformSkewPct) {
      return {
        passed: false,
        reason: `Extreme platform skew detected: ${skewPct.toFixed(1)}% > ${this.config.maxPlatformSkewPct}% (possible data issue)`,
        severity: 'critical',
      };
    }

    // Check for sustained skew
    if (this.hasSustainedSkew()) {
      return {
        passed: false,
        reason: 'Sustained platform skew detected over window',
        severity: 'warning',
      };
    }

    return { passed: true, severity: 'info' };
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private estimateSpread(market: Market): number {
    // If market type is sportsbook, spread is typically built into odds
    if (market.marketType === 'sportsbook') {
      // Decimal odds: spread ≈ (1/odds1 + 1/odds2) - 1
      // For now, estimate 2% spread
      return 0.02;
    }

    // For prediction markets, estimate from YES + NO prices
    const yesProb = market.yesPrice / 100;
    const noProb = market.noPrice / 100;
    const overround = yesProb + noProb - 1;

    // Spread is roughly half the overround
    return Math.max(0, overround / 2);
  }

  private getCombinedImplied(opp: ArbitrageOpportunity): number {
    // For binary arb: combined implied = price1 + (100 - price2)
    // Should be close to 100 for efficient markets
    const price1 =
      opp.side1 === 'yes' ? opp.market1.yesPrice : opp.market1.noPrice;
    const price2 =
      opp.side2 === 'yes' ? opp.market2.yesPrice : opp.market2.noPrice;

    // Normalize to implied probabilities
    const normalizePrice = (p: number, platform: string): number => {
      if (platform === 'sxbet') {
        // Decimal odds → probability
        return (1 / p) * 100;
      }
      return p; // Already in cents (0-100)
    };

    const implied1 = normalizePrice(price1, opp.market1.platform);
    const implied2 = normalizePrice(price2, opp.market2.platform);

    return implied1 + implied2;
  }

  private recordSkew(
    skewPct: number,
    platform1: string,
    platform2: string
  ): void {
    const now = Date.now();

    // Add new entry
    this.skewHistory.push({
      timestamp: now,
      skewPct,
      platforms: [platform1, platform2],
    });

    // Clean old entries
    const cutoff = now - this.config.skewWindowMs;
    this.skewHistory = this.skewHistory.filter((e) => e.timestamp > cutoff);
  }

  private hasSustainedSkew(): boolean {
    if (this.skewHistory.length < 5) {
      return false; // Not enough data
    }

    // Check if average skew over window exceeds threshold
    const avgSkew =
      this.skewHistory.reduce((sum, e) => sum + e.skewPct, 0) /
      this.skewHistory.length;

    return avgSkew > this.config.maxPlatformSkewPct * 0.7;
  }

  // --------------------------------------------------------------------------
  // Circuit Breaker Management
  // --------------------------------------------------------------------------

  /**
   * Record an execution result
   */
  recordExecutionResult(success: boolean, error?: string): void {
    const now = Date.now();

    this.recentResults.push({ timestamp: now, success, error });

    // Keep only recent results
    const cutoff = now - 60000; // 1 minute
    this.recentResults = this.recentResults.filter((r) => r.timestamp > cutoff);

    if (success) {
      this.circuitBreakerState.consecutiveFailures = 0;
    } else {
      this.circuitBreakerState.consecutiveFailures++;
      this.circuitBreakerState.lastError = error;

      if (
        this.circuitBreakerState.consecutiveFailures >=
        this.circuitBreakerConfig.maxConsecutiveFailures
      ) {
        this.openCircuit(`${this.circuitBreakerConfig.maxConsecutiveFailures} consecutive failures`);
      }
    }
  }

  private openCircuit(reason: string): void {
    this.circuitBreakerState.isOpen = true;
    this.circuitBreakerState.openReason = reason;
    this.circuitBreakerState.openedAt = new Date().toISOString();

    console.warn(`[LiveArbSafety] ⚠️ Circuit breaker OPEN: ${reason}`);

    // Schedule reset
    setTimeout(() => {
      this.resetCircuit();
    }, this.circuitBreakerConfig.cooldownMs);
  }

  /**
   * Reset the circuit breaker
   */
  resetCircuit(): void {
    this.circuitBreakerState = {
      isOpen: false,
      consecutiveFailures: 0,
    };
    console.log('[LiveArbSafety] Circuit breaker reset');
  }

  /**
   * Manually trip the circuit breaker
   */
  tripCircuit(reason: string): void {
    this.openCircuit(reason);
  }

  /**
   * Check if circuit breaker is open
   */
  isCircuitOpen(): boolean {
    return this.circuitBreakerState.isOpen;
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreakerState };
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Update safety configuration
   */
  updateConfig(config: Partial<LiveArbSafetyConfig>): void {
    this.config = { ...this.config, ...config };
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
  getConfig(): LiveArbSafetyConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let safetyCheckerInstance: LiveArbSafetyChecker | null = null;

/**
 * Get or create the safety checker singleton
 */
export function getLiveArbSafetyChecker(
  config?: Partial<LiveArbSafetyConfig>,
  cbConfig?: Partial<CircuitBreakerConfig>
): LiveArbSafetyChecker {
  if (!safetyCheckerInstance) {
    safetyCheckerInstance = new LiveArbSafetyChecker(config, cbConfig);
  }
  return safetyCheckerInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetLiveArbSafetyChecker(): void {
  safetyCheckerInstance = null;
}

