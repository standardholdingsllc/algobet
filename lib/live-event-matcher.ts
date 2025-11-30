/**
 * Live Event Matcher
 *
 * Deterministic rule-based matcher for cross-platform sports events.
 * Uses token-based matching instead of hardcoded alias maps:
 *
 * 1. Normalize titles to tokens (remove stopwords, sport keywords)
 * 2. Group events by sport + time bucket
 * 3. Score token overlap between events across platforms
 * 4. Build matched groups via connected components
 *
 * Produces MatchedEventGroups that represent the same real-world event
 * across multiple betting platforms.
 */

import {
  VendorEvent,
  MatchedEventGroup,
  LiveEventPlatform,
  LiveEventRegistrySnapshot,
  Sport,
  VendorEventStatus,
  LiveEventMatcherConfig,
} from '@/types/live-events';
import { buildLiveEventMatcherConfig } from './live-event-config';
import { getSnapshot } from './live-event-registry';
import {
  saveMatchedGroupsToFile,
  loadMatchedGroupsFromFile,
  loadMatchedGroupsFileData,
  getMatchedGroupsFileInfo,
} from './live-event-groups-store';
import {
  normalizeEventTitle,
  scoreTokenOverlap,
  tokensMatch,
  getTimeBucket,
  timeBucketsMatch,
  getCommonTokens,
  tokensToSlug,
  parseTeamsFromTitleTokens,
  TokenMatchScore,
} from './text-normalizer';

// ============================================================================
// Types
// ============================================================================

/** Unique event identifier */
type EventId = `${LiveEventPlatform}:${string}`;

/** Edge in the match graph */
interface MatchEdge {
  eventA: EventId;
  eventB: EventId;
  score: TokenMatchScore;
}

// ============================================================================
// Matched Groups Storage
// ============================================================================

/** In-memory store of matched groups */
const matchedGroups = new Map<string, MatchedEventGroup>();

/** Last update timestamp */
let lastMatcherRun = 0;

/** Last file save timestamp */
let lastFileSaveAt = 0;

/** Minimum interval between file saves (to avoid excessive I/O) */
const FILE_SAVE_INTERVAL_MS = 5000; // 5 seconds

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a unique event ID
 */
function makeEventId(event: VendorEvent): EventId {
  return `${event.platform}:${event.vendorMarketId}`;
}

/**
 * Ensure an event has normalized tokens
 */
function ensureTokens(event: VendorEvent): string[] {
  if (event.normalizedTokens && event.normalizedTokens.length > 0) {
    return event.normalizedTokens;
  }
  // Generate on the fly if not present
  const { tokens } = normalizeEventTitle(event.rawTitle, { sport: event.sport });
  return tokens;
}

/**
 * Get the time bucket for an event
 */
function getEventTimeBucket(event: VendorEvent, toleranceMs: number): number {
  if (!event.startTime) return 0; // Events without time go to bucket 0
  return getTimeBucket(event.startTime, toleranceMs);
}

// ============================================================================
// Connected Components Algorithm
// ============================================================================

/**
 * Find connected components using Union-Find (Disjoint Set Union)
 */
class UnionFind {
  private parent: Map<EventId, EventId> = new Map();
  private rank: Map<EventId, number> = new Map();

  find(x: EventId): EventId {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  union(x: EventId, y: EventId): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    
    if (rootX === rootY) return;
    
    const rankX = this.rank.get(rootX) || 0;
    const rankY = this.rank.get(rootY) || 0;
    
    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }

  /**
   * Get all components as arrays of event IDs
   */
  getComponents(allIds: EventId[]): EventId[][] {
    const groups = new Map<EventId, EventId[]>();
    
    for (const id of allIds) {
      const root = this.find(id);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(id);
    }
    
    return Array.from(groups.values());
  }
}

// ============================================================================
// Core Matching Logic
// ============================================================================

/**
 * Match events within a sport + time bucket using token overlap
 */
function matchEventsInBucket(
  events: VendorEvent[],
  config: LiveEventMatcherConfig
): MatchEdge[] {
  const edges: MatchEdge[] = [];
  
  // Group by platform
  const byPlatform = new Map<LiveEventPlatform, VendorEvent[]>();
  for (const event of events) {
    if (!byPlatform.has(event.platform)) {
      byPlatform.set(event.platform, []);
    }
    byPlatform.get(event.platform)!.push(event);
  }
  
  const platforms = Array.from(byPlatform.keys());
  
  // Compare events across platforms
  for (let i = 0; i < platforms.length; i++) {
    for (let j = i + 1; j < platforms.length; j++) {
      const eventsA = byPlatform.get(platforms[i])!;
      const eventsB = byPlatform.get(platforms[j])!;
      
      for (const eventA of eventsA) {
        const tokensA = ensureTokens(eventA);
        if (tokensA.length === 0) continue;
        
        for (const eventB of eventsB) {
          const tokensB = ensureTokens(eventB);
          if (tokensB.length === 0) continue;
          
          // Score token overlap
          const score = scoreTokenOverlap(tokensA, tokensB);
          
          // Check if passes thresholds
          if (score.overlap >= config.minTokenOverlap && 
              score.coverage >= config.minCoverage) {
            edges.push({
              eventA: makeEventId(eventA),
              eventB: makeEventId(eventB),
              score,
            });
          }
        }
      }
    }
  }
  
  return edges;
}

/**
 * Build MatchedEventGroup from a connected component
 */
function buildGroupFromComponent(
  eventIds: EventId[],
  eventMap: Map<EventId, VendorEvent>,
  edges: MatchEdge[],
  now: number
): MatchedEventGroup | null {
  // Collect all events
  const events: VendorEvent[] = [];
  for (const id of eventIds) {
    const event = eventMap.get(id);
    if (event) events.push(event);
  }
  
  if (events.length === 0) return null;
  
  // Get unique platforms
  const platforms = new Set(events.map(e => e.platform));
  if (platforms.size < 2) return null; // Need at least 2 platforms
  
  // Get sport (should be same for all)
  const sport = events[0].sport;
  
  // Collect all tokens
  const allTokenArrays = events.map(e => ensureTokens(e));
  const commonTokens = getCommonTokens(allTokenArrays);
  
  // Find median start time
  const startTimes = events
    .filter(e => e.startTime)
    .map(e => e.startTime!);
  const medianStartTime = startTimes.length > 0
    ? startTimes.sort((a, b) => a - b)[Math.floor(startTimes.length / 2)]
    : undefined;
  
  // Generate event key from sport + date + common tokens
  let dateStr = 'unknown';
  if (medianStartTime) {
    const date = new Date(medianStartTime);
    dateStr = date.toISOString().split('T')[0];
  }
  const tokenSlug = tokensToSlug(commonTokens, 4);
  const eventKey = `${sport}:${dateStr}:${tokenSlug || 'event'}`;
  
  // Determine status (LIVE if any are live)
  const hasLive = events.some(e => e.status === 'LIVE');
  const status: VendorEventStatus = hasLive ? 'LIVE' : 'PRE';
  
  // Build vendors map
  const vendors: MatchedEventGroup['vendors'] = {};
  for (const event of events) {
    if (!vendors[event.platform]) {
      vendors[event.platform] = [];
    }
    vendors[event.platform]!.push(event);
  }
  
  // Calculate match quality (average coverage of edges in this component)
  const componentEdges = edges.filter(e => 
    eventIds.includes(e.eventA) && eventIds.includes(e.eventB)
  );
  let avgCoverage = 0.5; // Default
  if (componentEdges.length > 0) {
    avgCoverage = componentEdges.reduce((sum, e) => sum + e.score.coverage, 0) / componentEdges.length;
  }
  
  // Bonus for 3+ platforms
  const quality = Math.min(1.0, avgCoverage + (platforms.size >= 3 ? 0.1 : 0));
  
  // Get team names from parsed tokens
  const homeTeam = commonTokens.length >= 2 ? commonTokens.slice(0, 2).join(' ') : commonTokens[0];
  const awayTeam = commonTokens.length >= 4 ? commonTokens.slice(2, 4).join(' ') : commonTokens[commonTokens.length - 1];
  
  // Get league from first event that has it
  const league = events.find(e => e.league)?.league;
  
  return {
    eventKey,
    sport,
    league,
    homeTeam,
    awayTeam,
    startTime: medianStartTime,
    status,
    vendors,
    platformCount: platforms.size,
    totalEvents: events.length,
    lastMatchedAt: now,
    matchQuality: quality,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Update matches based on current registry state
 */
export function updateMatches(snapshot?: LiveEventRegistrySnapshot): void {
  const config = buildLiveEventMatcherConfig();
  const registrySnapshot = snapshot || getSnapshot();
  const now = Date.now();
  
  // Get live and near-live events
  const activeEvents = registrySnapshot.events.filter(e => {
    if (e.status === 'LIVE') return true;
    if (e.status === 'PRE' && e.startTime) {
      const timeToStart = e.startTime - now;
      return timeToStart <= config.preGameWindow && timeToStart >= 0;
    }
    return false;
  });
  
  // Build event ID map
  const eventMap = new Map<EventId, VendorEvent>();
  for (const event of activeEvents) {
    eventMap.set(makeEventId(event), event);
  }
  
  // Group events by sport + time bucket
  const buckets = new Map<string, VendorEvent[]>();
  for (const event of activeEvents) {
    const timeBucket = getEventTimeBucket(event, config.timeTolerance);
    const bucketKey = `${event.sport}:${timeBucket}`;
    
    // Also add to adjacent buckets for matching
    const adjacentKeys = [
      bucketKey,
      `${event.sport}:${timeBucket - 1}`,
      `${event.sport}:${timeBucket + 1}`,
    ];
    
    for (const key of adjacentKeys) {
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      // Check if already in bucket
      const bucket = buckets.get(key)!;
      if (!bucket.some(e => makeEventId(e) === makeEventId(event))) {
        bucket.push(event);
      }
    }
  }
  
  // Find all matching edges across buckets
  const allEdges: MatchEdge[] = [];
  const seenPairs = new Set<string>();
  
  for (const [bucketKey, events] of buckets) {
    const edges = matchEventsInBucket(events, config);
    
    for (const edge of edges) {
      // Deduplicate edges
      const pairKey = [edge.eventA, edge.eventB].sort().join('|');
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        allEdges.push(edge);
      }
    }
  }
  
  // Build connected components using Union-Find
  const uf = new UnionFind();
  for (const edge of allEdges) {
    uf.union(edge.eventA, edge.eventB);
  }
  
  // Get all event IDs that have at least one edge
  const connectedIds = new Set<EventId>();
  for (const edge of allEdges) {
    connectedIds.add(edge.eventA);
    connectedIds.add(edge.eventB);
  }
  
  // Get components
  const components = uf.getComponents(Array.from(connectedIds));
  
  // Build matched groups from components
  const newGroups = new Map<string, MatchedEventGroup>();
  
  for (const component of components) {
    const group = buildGroupFromComponent(component, eventMap, allEdges, now);
    if (group && group.platformCount >= config.minPlatforms) {
      newGroups.set(group.eventKey, group);
    }
  }
  
  // Update the matched groups store
  // Keep existing groups that are still valid
  for (const [key, existingGroup] of matchedGroups) {
    if (!newGroups.has(key)) {
      // Check if group should be removed
      if (now - existingGroup.lastMatchedAt > config.postGameWindow) {
        matchedGroups.delete(key);
      }
    }
  }
  
  // Add/update new groups
  for (const [key, group] of newGroups) {
    matchedGroups.set(key, group);
  }
  
  lastMatcherRun = now;

  // Persist to file (rate-limited to avoid excessive I/O)
  persistGroupsToFile();
}

/**
 * Set matched groups directly (for testing or external loading)
 * Also persists to file.
 */
export function setMatchedGroups(groups: MatchedEventGroup[]): void {
  matchedGroups.clear();
  
  for (const group of groups) {
    matchedGroups.set(group.eventKey, group);
  }
  
  lastMatcherRun = Date.now();
  
  // Always persist when explicitly set
  const config = buildLiveEventMatcherConfig();
  const allGroups = Array.from(matchedGroups.values());
  saveMatchedGroupsToFile(allGroups, config);
  lastFileSaveAt = Date.now();
  
  console.log(`[LiveEventMatcher] Set ${groups.length} matched groups`);
}

/**
 * Persist groups to file (rate-limited)
 */
function persistGroupsToFile(): void {
  const now = Date.now();
  
  // Rate limit file saves
  if (now - lastFileSaveAt < FILE_SAVE_INTERVAL_MS) {
    return;
  }
  
  const config = buildLiveEventMatcherConfig();
  const groups = Array.from(matchedGroups.values());
  
  const saved = saveMatchedGroupsToFile(groups, config);
  if (saved) {
    lastFileSaveAt = now;
    console.log(`[LiveEventMatcher] Persisted ${groups.length} matched groups to file`);
  }
}

/**
 * Force persist groups to file (bypasses rate limiting)
 */
export function forcePersistGroupsToFile(): boolean {
  const config = buildLiveEventMatcherConfig();
  const groups = Array.from(matchedGroups.values());
  
  const saved = saveMatchedGroupsToFile(groups, config);
  if (saved) {
    lastFileSaveAt = Date.now();
    console.log(`[LiveEventMatcher] Force-persisted ${groups.length} matched groups to file`);
  }
  return saved;
}

/**
 * Load matched groups from file (for recovery or initialization)
 * Returns null if file doesn't exist or is invalid
 */
export function loadGroupsFromFile(): MatchedEventGroup[] | null {
  return loadMatchedGroupsFromFile();
}

/**
 * Get file info for debugging
 */
export function getGroupsFileInfo() {
  return {
    ...getMatchedGroupsFileInfo(),
    lastSavedAt: lastFileSaveAt > 0 ? new Date(lastFileSaveAt).toISOString() : null,
    fileData: loadMatchedGroupsFileData(),
  };
}

/**
 * Get matched event groups
 */
export function getMatchedEvents(filter?: {
  liveOnly?: boolean;
  minPlatforms?: number;
  sport?: Sport;
}): MatchedEventGroup[] {
  let groups = Array.from(matchedGroups.values());
  
  if (filter?.liveOnly) {
    groups = groups.filter(g => g.status === 'LIVE');
  }
  
  const minPlatforms = filter?.minPlatforms;
  if (typeof minPlatforms === 'number') {
    groups = groups.filter(g => g.platformCount >= minPlatforms);
  }
  
  if (filter?.sport) {
    groups = groups.filter(g => g.sport === filter.sport);
  }
  
  // Sort by quality descending
  groups.sort((a, b) => b.matchQuality - a.matchQuality);
  
  return groups;
}

/**
 * Get a specific matched group
 */
export function getMatchedGroup(eventKey: string): MatchedEventGroup | undefined {
  return matchedGroups.get(eventKey);
}

/**
 * Get matcher statistics
 */
export function getMatcherStats(): {
  totalGroups: number;
  liveGroups: number;
  preGroups: number;
  by3Platforms: number;
  by2Platforms: number;
  bySport: Record<string, number>;
  lastRunAt: number;
} {
  const groups = Array.from(matchedGroups.values());
  
  const bySport: Record<string, number> = {};
  for (const g of groups) {
    bySport[g.sport] = (bySport[g.sport] || 0) + 1;
  }
  
  return {
    totalGroups: groups.length,
    liveGroups: groups.filter(g => g.status === 'LIVE').length,
    preGroups: groups.filter(g => g.status === 'PRE').length,
    by3Platforms: groups.filter(g => g.platformCount >= 3).length,
    by2Platforms: groups.filter(g => g.platformCount === 2).length,
    bySport,
    lastRunAt: lastMatcherRun,
  };
}

/**
 * Clear all matched groups (for testing)
 */
export function clearMatchedGroups(): void {
  matchedGroups.clear();
  lastMatcherRun = 0;
}

/**
 * Log matcher state
 */
export function logMatcherState(): void {
  const stats = getMatcherStats();
  console.log('[LiveEventMatcher] Current state:');
  console.log(`  Total matched groups: ${stats.totalGroups}`);
  console.log(`  Live: ${stats.liveGroups}, Pre: ${stats.preGroups}`);
  console.log(`  3+ platforms: ${stats.by3Platforms}, 2 platforms: ${stats.by2Platforms}`);
  console.log(`  By sport: ${JSON.stringify(stats.bySport)}`);
}

// ============================================================================
// Legacy Compatibility Exports
// ============================================================================

// These functions are kept for backward compatibility but use token-based logic

/**
 * Normalize a team name (legacy - now returns input as-is since we use tokens)
 * @deprecated Use normalizeEventTitle from text-normalizer.ts instead
 */
export function normalizeTeamName(name: string, sport?: Sport): string {
  const { normalizedTitle } = normalizeEventTitle(name, { sport });
  return normalizedTitle;
}

/**
 * Parse teams from a title (legacy wrapper)
 * @deprecated Use parseTeamsFromTitleTokens from text-normalizer.ts instead
 */
export function parseTeamsFromTitle(rawTitle: string, sport?: Sport): {
  home?: string;
  away?: string;
  teams: string[];
} {
  const result = parseTeamsFromTitleTokens(rawTitle, sport);
  // For backward compatibility, split tokens into "teams" array
  return {
    home: result.home,
    away: result.away,
    teams: result.teams,
  };
}
