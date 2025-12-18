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
  watchersSkipped: Record<string, number>;
  subscriptionsAttempted: number;
  subscriptionsFailed: Record<string, number>;
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

export function getLiveEventsDebug(): LiveEventsDebugCounters {
  return {
    ...counters,
    vendorEventsByPlatform: { ...counters.vendorEventsByPlatform },
    vendorEventsFilteredOut: { ...counters.vendorEventsFilteredOut },
    matchRejectReasons: { ...counters.matchRejectReasons },
    watchersSkipped: { ...counters.watchersSkipped },
    subscriptionsFailed: { ...counters.subscriptionsFailed },
  };
}

