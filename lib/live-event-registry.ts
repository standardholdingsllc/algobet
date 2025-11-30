/**
 * Live Event Registry
 *
 * In-memory registry of live and near-live sporting events across all platforms.
 * Events are added by vendor-specific extractors and consumed by the matcher.
 *
 * Key responsibilities:
 * - Store and index vendor events by platform, sport, status
 * - Automatic cleanup of ended/stale events
 * - Provide snapshots for the matcher
 *
 * This is a singleton module - one global registry per process.
 */

import {
  VendorEvent,
  VendorEventStatus,
  LiveEventPlatform,
  LiveEventRegistrySnapshot,
  MatchedEventGroup,
  Sport,
  buildLiveEventMatcherConfig,
} from '@/types/live-events';
import { setMatchedGroups as setMatcherGroups } from './live-event-matcher';

// ============================================================================
// Internal State
// ============================================================================

/** Primary storage: Map<platform:vendorMarketId, VendorEvent> */
const eventStore = new Map<string, VendorEvent>();

/** Index by platform */
const byPlatform: Record<LiveEventPlatform, Set<string>> = {
  SXBET: new Set(),
  POLYMARKET: new Set(),
  KALSHI: new Set(),
};

/** Index by status */
const byStatus: Record<VendorEventStatus, Set<string>> = {
  PRE: new Set(),
  LIVE: new Set(),
  ENDED: new Set(),
};

/** Index by sport */
const bySport = new Map<Sport, Set<string>>();

/** Cleanup tracking */
let lastCleanupAt = Date.now();
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

/** Statistics */
let totalAdded = 0;
let totalUpdated = 0;
let totalRemoved = 0;

// ============================================================================
// Key Generation
// ============================================================================

function makeEventKey(platform: LiveEventPlatform, vendorMarketId: string): string {
  return `${platform}:${vendorMarketId}`;
}

// ============================================================================
// Index Management
// ============================================================================

function addToIndices(event: VendorEvent, key: string): void {
  byPlatform[event.platform].add(key);
  byStatus[event.status].add(key);
  
  if (!bySport.has(event.sport)) {
    bySport.set(event.sport, new Set());
  }
  bySport.get(event.sport)!.add(key);
}

function removeFromIndices(event: VendorEvent, key: string): void {
  byPlatform[event.platform].delete(key);
  byStatus[event.status].delete(key);
  bySport.get(event.sport)?.delete(key);
}

function updateIndicesForStatusChange(
  event: VendorEvent,
  key: string,
  oldStatus: VendorEventStatus,
  newStatus: VendorEventStatus
): void {
  byStatus[oldStatus].delete(key);
  byStatus[newStatus].add(key);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Add or update an event in the registry
 */
export function addOrUpdateEvent(event: VendorEvent): void {
  const key = makeEventKey(event.platform, event.vendorMarketId);
  const existing = eventStore.get(key);

  if (existing) {
    // Update existing event
    const oldStatus = existing.status;
    
    // Merge: prefer newer data
    const merged: VendorEvent = {
      ...existing,
      ...event,
      lastUpdatedAt: Date.now(),
    };
    
    eventStore.set(key, merged);
    
    // Update status index if changed
    if (oldStatus !== event.status) {
      updateIndicesForStatusChange(merged, key, oldStatus, event.status);
    }
    
    totalUpdated++;
  } else {
    // Add new event
    const newEvent: VendorEvent = {
      ...event,
      lastUpdatedAt: Date.now(),
    };
    
    eventStore.set(key, newEvent);
    addToIndices(newEvent, key);
    totalAdded++;
  }

  // Periodic cleanup
  maybeCleanup();
}

/**
 * Mark an event as ended
 */
export function markEventEnded(platform: LiveEventPlatform, vendorMarketId: string): void {
  const key = makeEventKey(platform, vendorMarketId);
  const event = eventStore.get(key);

  if (event && event.status !== 'ENDED') {
    const oldStatus = event.status;
    event.status = 'ENDED';
    event.lastUpdatedAt = Date.now();
    updateIndicesForStatusChange(event, key, oldStatus, 'ENDED');
  }
}

/**
 * Remove an event from the registry
 */
export function removeEvent(platform: LiveEventPlatform, vendorMarketId: string): boolean {
  const key = makeEventKey(platform, vendorMarketId);
  const event = eventStore.get(key);

  if (event) {
    removeFromIndices(event, key);
    eventStore.delete(key);
    totalRemoved++;
    return true;
  }
  return false;
}

/**
 * Get an event by platform and ID
 */
export function getEvent(platform: LiveEventPlatform, vendorMarketId: string): VendorEvent | undefined {
  const key = makeEventKey(platform, vendorMarketId);
  return eventStore.get(key);
}

/**
 * Get all current events with optional filters
 */
export function getCurrentEvents(filter?: {
  status?: VendorEventStatus | VendorEventStatus[];
  sport?: Sport | Sport[];
  platform?: LiveEventPlatform | LiveEventPlatform[];
  liveAndNearStart?: boolean;
}): VendorEvent[] {
  const config = buildLiveEventMatcherConfig();
  const now = Date.now();

  let candidateKeys: Set<string>;

  // Start with all keys or filter by status
  if (filter?.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    candidateKeys = new Set<string>();
    for (const s of statuses) {
      byStatus[s].forEach(k => candidateKeys.add(k));
    }
  } else {
    candidateKeys = new Set(eventStore.keys());
  }

  // Filter by platform
  if (filter?.platform) {
    const platforms = Array.isArray(filter.platform) ? filter.platform : [filter.platform];
    const platformKeys = new Set<string>();
    for (const p of platforms) {
      byPlatform[p].forEach(k => {
        if (candidateKeys.has(k)) platformKeys.add(k);
      });
    }
    candidateKeys = platformKeys;
  }

  // Filter by sport
  if (filter?.sport) {
    const sports = Array.isArray(filter.sport) ? filter.sport : [filter.sport];
    const sportKeys = new Set<string>();
    for (const s of sports) {
      bySport.get(s)?.forEach(k => {
        if (candidateKeys.has(k)) sportKeys.add(k);
      });
    }
    candidateKeys = sportKeys;
  }

  // Collect events
  let events: VendorEvent[] = [];
  for (const key of candidateKeys) {
    const event = eventStore.get(key);
    if (event) {
      events.push(event);
    }
  }

  // Filter for live and near-start if requested
  if (filter?.liveAndNearStart) {
    events = events.filter(e => {
      if (e.status === 'LIVE') return true;
      if (e.status === 'PRE' && e.startTime) {
        const timeToStart = e.startTime - now;
        return timeToStart <= config.preGameWindow && timeToStart >= -config.postGameWindow;
      }
      return false;
    });
  }

  return events;
}

/**
 * Get events by platform
 */
export function getEventsByPlatform(platform: LiveEventPlatform): VendorEvent[] {
  const events: VendorEvent[] = [];
  for (const key of byPlatform[platform]) {
    const event = eventStore.get(key);
    if (event) events.push(event);
  }
  return events;
}

/**
 * Get a snapshot of the registry
 */
export function getSnapshot(): LiveEventRegistrySnapshot {
  const events = Array.from(eventStore.values());

  return {
    events,
    updatedAt: Date.now(),
    countByPlatform: {
      SXBET: byPlatform.SXBET.size,
      POLYMARKET: byPlatform.POLYMARKET.size,
      KALSHI: byPlatform.KALSHI.size,
    },
    countByStatus: {
      PRE: byStatus.PRE.size,
      LIVE: byStatus.LIVE.size,
      ENDED: byStatus.ENDED.size,
    },
  };
}

/**
 * Get registry statistics
 */
export function getRegistryStats(): {
  totalEvents: number;
  byPlatform: Record<LiveEventPlatform, number>;
  byStatus: Record<VendorEventStatus, number>;
  bySport: Record<string, number>;
  totalAdded: number;
  totalUpdated: number;
  totalRemoved: number;
} {
  const sportCounts: Record<string, number> = {};
  for (const [sport, keys] of bySport) {
    sportCounts[sport] = keys.size;
  }

  return {
    totalEvents: eventStore.size,
    byPlatform: {
      SXBET: byPlatform.SXBET.size,
      POLYMARKET: byPlatform.POLYMARKET.size,
      KALSHI: byPlatform.KALSHI.size,
    },
    byStatus: {
      PRE: byStatus.PRE.size,
      LIVE: byStatus.LIVE.size,
      ENDED: byStatus.ENDED.size,
    },
    bySport: sportCounts,
    totalAdded,
    totalUpdated,
    totalRemoved,
  };
}

/**
 * Clear the entire registry (for testing)
 */
export function clearRegistry(): void {
  eventStore.clear();
  Object.values(byPlatform).forEach(s => s.clear());
  Object.values(byStatus).forEach(s => s.clear());
  bySport.clear();
  totalAdded = 0;
  totalUpdated = 0;
  totalRemoved = 0;
}

// ============================================================================
// Cleanup
// ============================================================================

function maybeCleanup(): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  
  lastCleanupAt = now;
  runCleanup();
}

/**
 * Remove stale/ended events
 */
export function runCleanup(): number {
  const config = buildLiveEventMatcherConfig();
  const now = Date.now();
  let removed = 0;

  for (const [key, event] of eventStore) {
    let shouldRemove = false;

    // Remove ENDED events after post-game window
    if (event.status === 'ENDED') {
      const endedDuration = now - event.lastUpdatedAt;
      if (endedDuration > config.postGameWindow) {
        shouldRemove = true;
      }
    }

    // Remove very old PRE events that never started
    if (event.status === 'PRE' && event.startTime) {
      const timeSinceStart = now - event.startTime;
      // If start time was more than 2 hours ago and still marked as PRE, remove
      if (timeSinceStart > 2 * 60 * 60 * 1000) {
        shouldRemove = true;
      }
    }

    // Remove events not updated in 30 minutes
    const staleDuration = now - event.lastUpdatedAt;
    if (staleDuration > 30 * 60 * 1000) {
      shouldRemove = true;
    }

    if (shouldRemove) {
      removeFromIndices(event, key);
      eventStore.delete(key);
      removed++;
      totalRemoved++;
    }
  }

  if (removed > 0) {
    console.log(`[LiveEventRegistry] Cleaned up ${removed} stale events`);
  }

  return removed;
}

// ============================================================================
// Logging
// ============================================================================

/**
 * Log current registry state
 */
export function logRegistryState(): void {
  const stats = getRegistryStats();
  console.log('[LiveEventRegistry] Current state:');
  console.log(`  Total events: ${stats.totalEvents}`);
  console.log(`  By platform: SX.bet=${stats.byPlatform.SXBET}, Polymarket=${stats.byPlatform.POLYMARKET}, Kalshi=${stats.byPlatform.KALSHI}`);
  console.log(`  By status: PRE=${stats.byStatus.PRE}, LIVE=${stats.byStatus.LIVE}, ENDED=${stats.byStatus.ENDED}`);
  console.log(`  Lifetime: added=${stats.totalAdded}, updated=${stats.totalUpdated}, removed=${stats.totalRemoved}`);
}

// ============================================================================
// Matched Groups (Pass-through to Matcher)
// ============================================================================

/**
 * Set matched groups (pass-through to matcher module).
 * This also persists the groups to file.
 * 
 * @param groups The matched groups to set
 */
export function setGroups(groups: MatchedEventGroup[]): void {
  setMatcherGroups(groups);
}

/**
 * Replace all events for a specific platform (snapshot update)
 * 
 * @param platform The platform to update
 * @param events The new events to set for that platform
 */
export function markPlatformSnapshot(platform: LiveEventPlatform, events: VendorEvent[]): void {
  // Remove all existing events for this platform
  const keysToRemove: string[] = [];
  for (const key of byPlatform[platform]) {
    keysToRemove.push(key);
  }
  
  for (const key of keysToRemove) {
    const event = eventStore.get(key);
    if (event) {
      removeFromIndices(event, key);
      eventStore.delete(key);
      totalRemoved++;
    }
  }
  
  // Add all new events
  for (const event of events) {
    const key = makeEventKey(event.platform, event.vendorMarketId);
    const newEvent: VendorEvent = {
      ...event,
      lastUpdatedAt: Date.now(),
    };
    eventStore.set(key, newEvent);
    addToIndices(newEvent, key);
    totalAdded++;
  }
  
  console.log(
    `[LiveEventRegistry] Snapshot for ${platform}: ` +
    `removed ${keysToRemove.length}, added ${events.length}`
  );
}

/**
 * Prune ended events from the registry
 * 
 * @param now Current timestamp (epoch ms)
 */
export function pruneEndedEvents(now: number): number {
  const config = buildLiveEventMatcherConfig();
  let pruned = 0;
  
  for (const [key, event] of eventStore) {
    let shouldPrune = false;
    
    // Prune ENDED events after post-game window
    if (event.status === 'ENDED') {
      const endedDuration = now - event.lastUpdatedAt;
      if (endedDuration > config.postGameWindow) {
        shouldPrune = true;
      }
    }
    
    // Prune events with start times far in the past that are still marked PRE
    if (event.status === 'PRE' && event.startTime) {
      const timeSinceStart = now - event.startTime;
      // If start time was more than 2 hours ago and still marked as PRE, prune
      if (timeSinceStart > 2 * 60 * 60 * 1000) {
        shouldPrune = true;
      }
    }
    
    if (shouldPrune) {
      removeFromIndices(event, key);
      eventStore.delete(key);
      pruned++;
      totalRemoved++;
    }
  }
  
  if (pruned > 0) {
    console.log(`[LiveEventRegistry] Pruned ${pruned} ended/stale events`);
  }
  
  return pruned;
}

