import { LiveEventPlatform, VendorEventStatus } from '@/types/live-events';

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
  watchersCreatedPre: number;  // Phase 6
  watchersCreatedLive: number; // Phase 6
  watchersSkipped: Record<string, number>;
  subscriptionsAttempted: number;
  subscriptionsAttemptedPre: number;  // Phase 6
  subscriptionsAttemptedLive: number; // Phase 6
  subscriptionsFailed: Record<string, number>;
  platformFetch: {
    kalshi: { attempted: number; skipped: number; skipReasons: Record<string, number> };
    polymarket: { attempted: number; skipped: number; skipReasons: Record<string, number> };
    sxbet: { attempted: number; skipped: number; skipReasons: Record<string, number> };
  };
  kalshi: {
    fetchAttempted: number;
    fetchFailed: number;
    rawItemsCount: number;
    parsedEventsCount: number;
    filteredOut: Record<string, number>;
    filteredToCloseWindowCount: number;
    filteredByStatusCount: number;
    rawStatusHistogram: Record<string, number>;
    dropReasons: Record<string, number>;
    sampleDroppedItems: Array<{
      ticker?: string;
      title?: string;
      status?: string;
      event_ticker?: string;
      series_ticker?: string;
      close_time?: string;
      expiration_time?: string;
    }>;
    queryApplied: undefined | Record<string, unknown>;
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
  watchersCreatedPre: 0,
  watchersCreatedLive: 0,
  watchersSkipped: {},
  subscriptionsAttempted: 0,
  subscriptionsAttemptedPre: 0,
  subscriptionsAttemptedLive: 0,
  subscriptionsFailed: {},
    platformFetch: {
      kalshi: { attempted: 0, skipped: 0, skipReasons: {} },
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
    filteredByStatusCount: 0,
    rawStatusHistogram: {},
    dropReasons: {},
    sampleDroppedItems: [],
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
    watchersCreatedPre: 0,
    watchersCreatedLive: 0,
    watchersSkipped: {},
    subscriptionsAttempted: 0,
    subscriptionsAttemptedPre: 0,
    subscriptionsAttemptedLive: 0,
    subscriptionsFailed: {},
    platformFetch: {
      kalshi: { attempted: 0, skipped: 0, skipReasons: {} },
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
      filteredByStatusCount: 0,
      rawStatusHistogram: {},
      dropReasons: {},
      sampleDroppedItems: [],
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

export function recordWatcherCreated(): void {
  counters.watchersCreated += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordWatcherCreatedPre(): void {
  counters.watchersCreatedPre += 1;
  counters.watchersCreated += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordWatcherCreatedLive(): void {
  counters.watchersCreatedLive += 1;
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

export function recordSubscriptionAttemptPre(): void {
  counters.subscriptionsAttemptedPre += 1;
  counters.subscriptionsAttempted += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordSubscriptionAttemptLive(): void {
  counters.subscriptionsAttemptedLive += 1;
  counters.subscriptionsAttempted += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordSubscriptionFailed(reason: string): void {
  bump(counters.subscriptionsFailed, reason);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordPlatformFetchAttempt(platform: 'kalshi' | 'polymarket' | 'sxbet'): void {
  counters.platformFetch[platform].attempted += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordPlatformFetchAttempted(platform: 'kalshi' | 'polymarket' | 'sxbet'): void {
  counters.platformFetch[platform].attempted += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordPlatformFetchError(platform: 'kalshi' | 'polymarket' | 'sxbet', error?: string): void {
  // This could be used to track fetch errors
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordPlatformFetchSkipped(platform: 'kalshi' | 'polymarket' | 'sxbet', reason: string): void {
  counters.platformFetch[platform].skipped += 1;
  bump(counters.platformFetch[platform].skipReasons, reason);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiFetchAttempted(): void {
  counters.kalshi.fetchAttempted += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiFetchFailed(status?: number, error?: string): void {
  counters.kalshi.fetchFailed += 1;
  if (status) {
    const statusStr = status.toString();
    bump(counters.kalshi.rawStatusHistogram, statusStr);
  }
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiHttpStatus(status: number): void {
  const statusStr = status.toString();
  bump(counters.kalshi.rawStatusHistogram, statusStr);
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

export function recordKalshiFilteredToCloseWindow(count: number = 1): void {
  counters.kalshi.filteredToCloseWindowCount += count;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiFilteredByStatus(count: number = 1): void {
  counters.kalshi.filteredByStatusCount += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiDropReason(reason: string): void {
  bump(counters.kalshi.dropReasons, reason);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiDroppedItem(item: Record<string, any>): void {
  if (counters.kalshi.sampleDroppedItems.length < 3) {
    counters.kalshi.sampleDroppedItems.push({
      ticker: item.ticker,
      title: item.title,
      status: item.status,
      event_ticker: item.event_ticker,
      series_ticker: item.series_ticker,
      close_time: item.close_time,
      expiration_time: item.expiration_time,
    });
  }
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiQueryApplied(query: Record<string, unknown>): void {
  counters.kalshi.queryApplied = query;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiEventsFetch(success: boolean, count?: number, withMarketsCount?: number): void {
  counters.kalshi.fetchAttempted += 1;
  if (!success) {
    counters.kalshi.fetchFailed += 1;
  }
  if (count !== undefined) {
    counters.kalshi.rawItemsCount = count;
  }
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiEventClassification(status: string): void {
  // This function seems to be used for general event classification
  // We can increment a counter for the status
  bump(counters.kalshi.rawStatusHistogram, status);
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshi429(info?: {
  retryAfterSec?: number | null;
  backoffUntilMs?: number;
  consecutive429?: number;
  last429AtMs?: number;
}): void {
  counters.kalshi.fetchFailed += 1;
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiCacheEvent(event: string, hit: boolean): void {
  // Track cache events
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiRateLimitState(state: any): void {
  // Track rate limit state
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordKalshiRawStatusHistogram(histogram: Record<string, number>): void {
  for (const [status, count] of Object.entries(histogram)) {
    counters.kalshi.rawStatusHistogram[status] = (counters.kalshi.rawStatusHistogram[status] || 0) + count;
  }
  counters.lastUpdatedAt = new Date().toISOString();
}

export function recordWatcherCreatedByStatus(status: 'LIVE' | 'PRE'): void {
  if (status === 'LIVE') {
    recordWatcherCreatedLive();
  } else {
    recordWatcherCreatedPre();
  }
}

export function recordSubscriptionAttemptByStatus(status: 'LIVE' | 'PRE'): void {
  if (status === 'LIVE') {
    recordSubscriptionAttemptLive();
  } else {
    recordSubscriptionAttemptPre();
  }
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
      rawStatusHistogram: { ...counters.kalshi.rawStatusHistogram },
      dropReasons: { ...counters.kalshi.dropReasons },
      sampleDroppedItems: [...counters.kalshi.sampleDroppedItems],
      sampleRawItems: [...counters.kalshi.sampleRawItems],
    },
  };
}
