import { LiveEventPlatform, VendorEventStatus } from '@/types/live-events';

export interface KalshiRateLimitDebug {
  backoff: {
    backoffUntilMs: number | null;
    consecutive429: number;
    last429AtMs: number | null;
    lastRetryAfterSec: number | null;
    active: boolean;
  };
  gate: {
    minIntervalMs: number;
    lastAtMs: number;
  };
  cache: {
    seriesSize: number;
    marketsSize: number;
    marketsTtlMs: number;
    seriesTtlMs: number;
  };
}

export interface LiveEventsDebugCounters {
  lastUpdatedAt: string;
  vendorEventsFetched: number;
  vendorEventsByPlatform: Record<LiveEventPlatform, number>;
  vendorEventsFilteredOut: Record<string, number>;
  liveClassifiedCount: number;
  preClassifiedCount: number;
  matchCandidatesConsidered: number;
  matchRejectReasons: Record<string, number>;
  watchersCreated: number;
  watchersSkipped: Record<string, number>;
  subscriptionsAttempted: number;
  subscriptionsFailed: Record<string, number>;
  platformFetch: Record<
    'kalshi' | 'polymarket' | 'sxbet',
    {
      attempted: number;
      skipped: number;
      skipReasons: Record<string, number>;
      lastError?: string;
      cache?: {
        seriesHit: number;
        seriesMiss: number;
        marketsHit: number;
        marketsMiss: number;
      };
      rateLimit?: KalshiRateLimitDebug;
      last429?: {
        retryAfterSec?: number | null;
        backoffUntilMs?: number | null;
        consecutive429?: number;
        last429AtMs?: number | null;
      };
    }
  >;
  kalshi: {
    fetchAttempted: number;
    fetchFailed: number;
    lastError?: string;
    lastHttpStatus?: number;
    rawItemsCount: number;
    parsedEventsCount: number;
    filteredOut: Record<string, number>;
    filteredToCloseWindowCount?: number;
    queryApplied?: {
      seriesTicker?: string;
      maxCloseTs?: number;
      minCloseTs?: number;
      status?: string;
      allowFallbackAllMarkets?: boolean;
      fallbackUsed?: boolean;
      fallbackReason?: string;
      discoveredSeriesTickersCount?: number;
      seriesTickersUsed?: string[];
      marketsFetchedBySeries?: Record<string, number>;
      totalPagesFetched?: number;
      cappedByMaxTotalMarkets?: boolean;
      discoveryFailedReason?: string | null;
      seriesTickersTotal?: number;
      seriesTickersChosen?: string[];
      maxSeriesPerRefresh?: number;
    };
    sampleRawItems: Array<{
      ticker?: string;
      title?: string;
      status?: string;
      event_ticker?: string;
      series_ticker?: string;
      close_time?: string;
      expiration_time?: string;
    }>;
  };
}

const emptyPlatformCounts: Record<LiveEventPlatform, number> = {
  SXBET: 0,
  POLYMARKET: 0,
  KALSHI: 0,
};

let counters: LiveEventsDebugCounters = {
  lastUpdatedAt: new Date(0).toISOString(),
  vendorEventsFetched: 0,
  vendorEventsByPlatform: { ...emptyPlatformCounts },
  vendorEventsFilteredOut: {},
  liveClassifiedCount: 0,
  preClassifiedCount: 0,
  matchCandidatesConsidered: 0,
  matchRejectReasons: {},
  watchersCreated: 0,
  watchersSkipped: {},
  subscriptionsAttempted: 0,
  subscriptionsFailed: {},
  platformFetch: {
    kalshi: {
      attempted: 0,
      skipped: 0,
      skipReasons: {},
      cache: {
        seriesHit: 0,
        seriesMiss: 0,
        marketsHit: 0,
        marketsMiss: 0,
      },
    },
    polymarket: { attempted: 0, skipped: 0, skipReasons: {} },
    sxbet: { attempted: 0, skipped: 0, skipReasons: {} },
  },
  kalshi: {
    fetchAttempted: 0,
    fetchFailed: 0,
    rawItemsCount: 0,
    parsedEventsCount: 0,
    filteredOut: {},
    filteredToCloseWindowCount: 0,
    queryApplied: undefined,
    sampleRawItems: [],
  },
};

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

export function resetLiveEventsDebug(): void {
  counters = {
    lastUpdatedAt: new Date().toISOString(),
    vendorEventsFetched: 0,
    vendorEventsByPlatform: { ...emptyPlatformCounts },
    vendorEventsFilteredOut: {},
    liveClassifiedCount: 0,
    preClassifiedCount: 0,
    matchCandidatesConsidered: 0,
    matchRejectReasons: {},
    watchersCreated: 0,
    watchersSkipped: {},
    subscriptionsAttempted: 0,
    subscriptionsFailed: {},
    platformFetch: {
    kalshi: {
      attempted: 0,
      skipped: 0,
      skipReasons: {},
      cache: {
        seriesHit: 0,
        seriesMiss: 0,
        marketsHit: 0,
        marketsMiss: 0,
      },
    },
      polymarket: { attempted: 0, skipped: 0, skipReasons: {} },
      sxbet: { attempted: 0, skipped: 0, skipReasons: {} },
    },
    kalshi: {
      fetchAttempted: 0,
      fetchFailed: 0,
      rawItemsCount: 0,
      parsedEventsCount: 0,
      filteredOut: {},
      filteredToCloseWindowCount: 0,
      queryApplied: undefined,
      sampleRawItems: [],
    },
  };
}

export function recordVendorEventsFetched(
  platform: LiveEventPlatform,
  count: number
): void {
  counters.vendorEventsFetched += count;
  counters.vendorEventsByPlatform[platform] =
    (counters.vendorEventsByPlatform[platform] || 0) + count;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordVendorEventFiltered(reason: string): void {
  bump(counters.vendorEventsFilteredOut, reason);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordClassification(status: VendorEventStatus): void {
  if (status === 'LIVE') counters.liveClassifiedCount += 1;
  if (status === 'PRE') counters.preClassifiedCount += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordMatchCandidatesConsidered(count: number): void {
  counters.matchCandidatesConsidered = count;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordMatchReject(reason: string): void {
  bump(counters.matchRejectReasons, reason);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordPlatformFetchAttempt(platform: 'kalshi' | 'polymarket' | 'sxbet'): void {
  counters.platformFetch[platform].attempted += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordPlatformFetchSkipped(
  platform: 'kalshi' | 'polymarket' | 'sxbet',
  reason: string
): void {
  counters.platformFetch[platform].skipped += 1;
  bump(counters.platformFetch[platform].skipReasons, reason);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordPlatformFetchError(
  platform: 'kalshi' | 'polymarket' | 'sxbet',
  error: string
): void {
  counters.platformFetch[platform].lastError = error.slice(0, 200);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiCacheEvent(
  type: 'series' | 'markets',
  hit: boolean
): void {
  const cache = counters.platformFetch.kalshi.cache;
  if (!cache) return;

  const key =
    type === 'series'
      ? hit
        ? 'seriesHit'
        : 'seriesMiss'
      : hit
      ? 'marketsHit'
      : 'marketsMiss';

  cache[key] += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiRateLimitState(state: KalshiRateLimitDebug): void {
  counters.platformFetch.kalshi.rateLimit = state;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshi429(details: {
  retryAfterSec?: number | null;
  backoffUntilMs?: number | null;
  consecutive429?: number;
  last429AtMs?: number | null;
}): void {
  counters.platformFetch.kalshi.last429 = details;
  counters.platformFetch.kalshi.lastError = '429';
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordWatcherCreated(): void {
  counters.watchersCreated += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordWatcherSkipped(reason: string): void {
  bump(counters.watchersSkipped, reason);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordSubscriptionAttempt(): void {
  counters.subscriptionsAttempted += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordSubscriptionFailed(reason: string): void {
  bump(counters.subscriptionsFailed, reason);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiFetchAttempted(): void {
  counters.kalshi.fetchAttempted += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiFetchFailed(status?: number, error?: string): void {
  counters.kalshi.fetchFailed += 1;
  counters.kalshi.lastHttpStatus = status ?? counters.kalshi.lastHttpStatus;
  if (error) {
    counters.kalshi.lastError = error.slice(0, 200);
  }
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiHttpStatus(status: number): void {
  counters.kalshi.lastHttpStatus = status;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiRawItems(
  count: number,
  samples: Array<Record<string, any>>
): void {
  counters.kalshi.rawItemsCount = count;
  counters.kalshi.sampleRawItems = samples.slice(0, 3).map((item) => ({
    ticker: item.ticker,
    title: item.title,
    status: item.status,
    event_ticker: item.event_ticker,
    series_ticker: item.series_ticker,
    close_time: item.close_time,
    expiration_time: item.expiration_time,
  }));
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiParsedEvent(): void {
  counters.kalshi.parsedEventsCount += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiFiltered(reason: string): void {
  bump(counters.kalshi.filteredOut, reason);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiFilteredToCloseWindow(count: number): void {
  counters.kalshi.filteredToCloseWindowCount = count;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiQueryApplied(query: {
  seriesTicker?: string;
  maxCloseTs?: number;
  minCloseTs?: number;
  status?: string;
  allowFallbackAllMarkets?: boolean;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  discoveredSeriesTickersCount?: number;
  seriesTickersUsed?: string[];
  marketsFetchedBySeries?: Record<string, number>;
  totalPagesFetched?: number;
  cappedByMaxTotalMarkets?: boolean;
  discoveryFailedReason?: string | null;
  seriesTickersTotal?: number;
  seriesTickersChosen?: string[];
  maxSeriesPerRefresh?: number;
}): void {
  counters.kalshi.queryApplied = query;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function getLiveEventsDebug(): LiveEventsDebugCounters {
  return {
    ...counters,
    vendorEventsByPlatform: { ...counters.vendorEventsByPlatform },
    vendorEventsFilteredOut: { ...counters.vendorEventsFilteredOut },
    matchRejectReasons: { ...counters.matchRejectReasons },
    watchersSkipped: { ...counters.watchersSkipped },
    subscriptionsFailed: { ...counters.subscriptionsFailed },
    platformFetch: {
      kalshi: {
        ...counters.platformFetch.kalshi,
        skipReasons: { ...counters.platformFetch.kalshi.skipReasons },
        cache: counters.platformFetch.kalshi.cache
          ? { ...counters.platformFetch.kalshi.cache }
          : undefined,
        rateLimit: counters.platformFetch.kalshi.rateLimit
          ? { ...counters.platformFetch.kalshi.rateLimit }
          : undefined,
        last429: counters.platformFetch.kalshi.last429
          ? { ...counters.platformFetch.kalshi.last429 }
          : undefined,
      },
      polymarket: {
        ...counters.platformFetch.polymarket,
        skipReasons: { ...counters.platformFetch.polymarket.skipReasons },
      },
      sxbet: {
        ...counters.platformFetch.sxbet,
        skipReasons: { ...counters.platformFetch.sxbet.skipReasons },
      },
    },
    kalshi: {
      ...counters.kalshi,
      filteredOut: { ...counters.kalshi.filteredOut },
      sampleRawItems: [...counters.kalshi.sampleRawItems],
    },
  };
}

