const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const parsedMarketsCacheTtl = parseInt(process.env.KALSHI_MARKETS_CACHE_TTL_MS || '', 10);
const parsedSeriesCacheTtl = parseInt(process.env.KALSHI_SERIES_CACHE_TTL_MS || '', 10);
const parsedRequestInterval = parseInt(process.env.KALSHI_REQUEST_MIN_INTERVAL_MS || '', 10);
const parsedBackoffBase = parseInt(process.env.KALSHI_BACKOFF_BASE_MS || '', 10);
const parsedBackoffMax = parseInt(process.env.KALSHI_BACKOFF_MAX_MS || '', 10);
const parsedMaxSeriesPerRefresh = parseInt(process.env.KALSHI_MAX_SERIES_PER_REFRESH || '', 10);
const parsedSeriesProbeCount = parseInt(process.env.KALSHI_SERIES_PROBE_COUNT || '', 10);

export const KALSHI_MARKETS_CACHE_TTL_MS = clamp(
  Number.isFinite(parsedMarketsCacheTtl) ? parsedMarketsCacheTtl : 45_000,
  30_000,
  60_000
);
export const KALSHI_SERIES_CACHE_TTL_MS = Math.max(
  60_000,
  Number.isFinite(parsedSeriesCacheTtl) ? parsedSeriesCacheTtl : 300_000
);
export const KALSHI_REQUEST_MIN_INTERVAL_MS = Math.max(
  0,
  Number.isFinite(parsedRequestInterval) ? parsedRequestInterval : 150
);
export const KALSHI_BACKOFF_BASE_MS = Math.max(
  1_000,
  Number.isFinite(parsedBackoffBase) ? parsedBackoffBase : 5_000
);
export const KALSHI_BACKOFF_MAX_MS = Math.max(
  KALSHI_BACKOFF_BASE_MS,
  Number.isFinite(parsedBackoffMax) ? parsedBackoffMax : 120_000
);
export const KALSHI_MAX_SERIES_PER_REFRESH = Math.max(
  1,
  Number.isFinite(parsedMaxSeriesPerRefresh) ? parsedMaxSeriesPerRefresh : 6
);
export const KALSHI_SERIES_PROBE_COUNT = clamp(
  Number.isFinite(parsedSeriesProbeCount) ? parsedSeriesProbeCount : 2,
  1,
  2
);
export const KALSHI_SERIES_REQUEST_DELAY_MS = 100;

export class TtlCache<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>();

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  size(): number {
    return this.store.size;
  }
}

export class MinIntervalGate {
  private lastAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private minIntervalMs: number) {}

  wait(): Promise<void> {
    const run = async () => {
      const now = Date.now();
      const waitMs = Math.max(0, this.lastAt + this.minIntervalMs - now);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.lastAt = Date.now();
    };

    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  getLastAt(): number {
    return this.lastAt;
  }
}

export class BackoffState {
  backoffUntilMs: number | null = null;
  consecutive429 = 0;
  last429AtMs: number | null = null;
  lastRetryAfterSec: number | null = null;

  isActive(): boolean {
    return this.backoffUntilMs !== null && this.backoffUntilMs > Date.now();
  }

  activate({
    retryAfterSec,
    baseMs,
    maxMs,
  }: {
    retryAfterSec?: number | null;
    baseMs: number;
    maxMs: number;
  }): number {
    this.consecutive429 += 1;
    this.last429AtMs = Date.now();
    this.lastRetryAfterSec = retryAfterSec ?? null;

    const exponentialMs = baseMs * Math.pow(2, Math.max(0, this.consecutive429 - 1));
    const retryMs = retryAfterSec ? retryAfterSec * 1000 : exponentialMs;
    const backoffMs = Math.min(maxMs, Math.max(baseMs, retryMs));
    this.backoffUntilMs = this.last429AtMs + backoffMs;
    return backoffMs;
  }

  clearOnSuccess(): void {
    this.consecutive429 = 0;
    this.backoffUntilMs = null;
    this.lastRetryAfterSec = null;
    this.last429AtMs = null;
  }
}

// Shared singletons for the worker process
const kalshiBackoffState = new BackoffState();
const kalshiRequestGate = new MinIntervalGate(KALSHI_REQUEST_MIN_INTERVAL_MS);
const kalshiSeriesCache = new TtlCache<string, any>();
const kalshiMarketsCache = new TtlCache<string, any>();

export function getKalshiRateLimitPrimitives() {
  return {
    backoff: kalshiBackoffState,
    gate: kalshiRequestGate,
    seriesCache: kalshiSeriesCache,
    marketsCache: kalshiMarketsCache,
  };
}

export function getKalshiRateLimitDebug() {
  return {
    backoff: {
      backoffUntilMs: kalshiBackoffState.backoffUntilMs,
      consecutive429: kalshiBackoffState.consecutive429,
      last429AtMs: kalshiBackoffState.last429AtMs,
      lastRetryAfterSec: kalshiBackoffState.lastRetryAfterSec,
      active: kalshiBackoffState.isActive(),
    },
    gate: {
      minIntervalMs: KALSHI_REQUEST_MIN_INTERVAL_MS,
      lastAtMs: kalshiRequestGate.getLastAt(),
    },
    cache: {
      seriesSize: kalshiSeriesCache.size(),
      marketsSize: kalshiMarketsCache.size(),
      marketsTtlMs: KALSHI_MARKETS_CACHE_TTL_MS,
      seriesTtlMs: KALSHI_SERIES_CACHE_TTL_MS,
    },
  };
}

/**
 * How to verify (manual checklist):
 * - Start live-arb worker and hit /api/live-arb/status to see platformFetch.kalshi.rateLimit reflecting caches/backoff.
 * - Trigger a 429 (or force Retry-After) and confirm logs show backoff activation and requests pause until expiry.
 * - Watch cache hit/miss counters and markets fetched remain stable while respecting 150ms spacing and 100ms series delay.
 */

