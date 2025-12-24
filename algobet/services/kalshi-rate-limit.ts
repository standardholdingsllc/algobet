/**
 * Kalshi Rate Limiting Utilities
 * 
 * Provides rate limiting primitives, caching, and backoff management for Kalshi API calls.
 */

// ============================================================================
// Constants
// ============================================================================

/** Base backoff delay in milliseconds after a 429 response */
export const KALSHI_BACKOFF_BASE_MS = 5000;

/** Maximum backoff delay in milliseconds */
export const KALSHI_BACKOFF_MAX_MS = 60000;

/** TTL for cached series data in milliseconds */
export const KALSHI_SERIES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** TTL for cached markets data in milliseconds */
export const KALSHI_MARKETS_CACHE_TTL_MS = 60 * 1000; // 1 minute

/** Maximum number of series to refresh per cycle */
export const KALSHI_MAX_SERIES_PER_REFRESH = 20;

/** Number of series to probe during discovery */
export const KALSHI_SERIES_PROBE_COUNT = 10;

/** Delay between series requests in milliseconds */
export const KALSHI_SERIES_REQUEST_DELAY_MS = 200;

// ============================================================================
// TtlCache - Generic TTL-based cache
// ============================================================================

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private defaultTtlMs: number = 60000) {
    // Periodic cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  set(key: K, value: V, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.cache.set(key, { value, expiresAt });
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    this.cleanup();
    return this.cache.size;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }
}

// ============================================================================
// BackoffState - Manages exponential backoff after rate limit hits
// ============================================================================

interface ActivateOptions {
  retryAfterSec?: number | null;
  baseMs: number;
  maxMs: number;
}

class BackoffState {
  backoffUntilMs: number = 0;
  consecutive429: number = 0;
  last429AtMs: number = 0;

  isActive(): boolean {
    return Date.now() < this.backoffUntilMs;
  }

  activate(options: ActivateOptions): number {
    const { retryAfterSec, baseMs, maxMs } = options;
    this.consecutive429++;
    this.last429AtMs = Date.now();

    let backoffMs: number;
    if (retryAfterSec && retryAfterSec > 0) {
      // Use server-provided retry-after
      backoffMs = retryAfterSec * 1000;
    } else {
      // Exponential backoff: baseMs * 2^(consecutive-1), capped at maxMs
      backoffMs = Math.min(baseMs * Math.pow(2, this.consecutive429 - 1), maxMs);
    }

    this.backoffUntilMs = Date.now() + backoffMs;
    return backoffMs;
  }

  clearOnSuccess(): void {
    this.consecutive429 = 0;
    this.backoffUntilMs = 0;
  }

  getDebugInfo(): object {
    return {
      isActive: this.isActive(),
      backoffUntilMs: this.backoffUntilMs,
      consecutive429: this.consecutive429,
      last429AtMs: this.last429AtMs,
      remainingMs: Math.max(0, this.backoffUntilMs - Date.now()),
    };
  }
}

// ============================================================================
// RequestGate - Manages concurrent request limiting
// ============================================================================

class RequestGate {
  private activeRequests: number = 0;
  private readonly maxConcurrent: number;
  private waitQueue: Array<() => void> = [];

  constructor(maxConcurrent: number = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  canProceed(): boolean {
    return this.activeRequests < this.maxConcurrent;
  }

  acquire(): boolean {
    if (!this.canProceed()) return false;
    this.activeRequests++;
    return true;
  }

  release(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    // Wake up next waiter if any
    if (this.waitQueue.length > 0 && this.canProceed()) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }

  /**
   * Wait until a slot is available, then acquire it.
   * Returns immediately if a slot is available.
   */
  async wait(): Promise<void> {
    if (this.acquire()) {
      return;
    }

    // Wait for a slot to become available
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeRequests++;
        resolve();
      });
    });
  }

  getActiveCount(): number {
    return this.activeRequests;
  }
}

// ============================================================================
// Singleton Instances (shared across the application)
// ============================================================================

const kalshiBackoff = new BackoffState();
const kalshiGate = new RequestGate(5);
const kalshiSeriesCache = new TtlCache<string, any>(KALSHI_SERIES_CACHE_TTL_MS);
const kalshiMarketsCache = new TtlCache<string, any>(KALSHI_MARKETS_CACHE_TTL_MS);

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Get the shared rate limiting primitives for Kalshi API calls.
 * These are singleton instances shared across the application.
 */
export function getKalshiRateLimitPrimitives() {
  return {
    backoff: kalshiBackoff,
    gate: kalshiGate,
    seriesCache: kalshiSeriesCache,
    marketsCache: kalshiMarketsCache,
  };
}

/**
 * Get debug information about the current rate limit state.
 */
export function getKalshiRateLimitDebug() {
  return {
    backoff: kalshiBackoff.getDebugInfo(),
    gate: {
      activeRequests: kalshiGate.getActiveCount(),
      canProceed: kalshiGate.canProceed(),
    },
    cache: {
      seriesCacheSize: kalshiSeriesCache.size(),
      marketsCacheSize: kalshiMarketsCache.size(),
    },
  };
}

