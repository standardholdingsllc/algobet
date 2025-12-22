/**
 * API Endpoint: GET /api/live-arb/live-events
 *
 * Returns the current state of the rule-based live sports matcher system.
 * 
 * IMPORTANT: This serverless endpoint reads from KV storage, NOT from in-memory state.
 * The worker process writes snapshots to KV periodically, and this endpoint reads them.
 * This enables cross-process visibility between the DO worker and Vercel serverless.
 *
 * Includes:
 * - Configuration snapshot
 * - Registry snapshot (all tracked vendor events)
 * - Matched event groups (cross-platform matches)
 * - Active watchers with timing stats
 * - Rate limiter status
 * - Statistics
 * - Debug fields for diagnosing matching issues
 *
 * Query Parameters:
 * - liveOnly: Only return live events (not pre-game)
 * - minPlatforms: Minimum platforms for matched groups (default: 2)
 * - sport: Filter by sport (e.g., NBA, NFL)
 * - limit: Maximum number of matched groups to return
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { loadLiveArbRuntimeConfig } from '@/lib/live-arb-runtime-config';
import { buildLiveEventMatcherConfig } from '@/lib/live-event-config';
import {
  getWorkerHeartbeat,
  getLiveEventsSnapshot,
  isHeartbeatFresh,
  LiveEventsSnapshot,
} from '@/lib/kv-storage';
import { Sport, VendorEventStatus, LiveEventPlatform } from '@/types/live-events';

/**
 * Heartbeat TTL - worker is considered "present" if heartbeat is fresher than this.
 */
const WORKER_HEARTBEAT_STALE_MS = parseInt(
  process.env.WORKER_HEARTBEAT_STALE_MS || '60000',
  10
);

/**
 * Schema version for debug fields - increment when debug shape changes.
 */
const DEBUG_SCHEMA_VERSION = 2;

/**
 * Debug fields computed from snapshot for diagnosing "0 groups" issues.
 */
interface LiveEventsDebugInfo {
  /** Schema version - increment when debug shape changes */
  schemaVersion: number;
  
  /** Counts of events with marketKind=MATCHUP per platform */
  matchupCountsByPlatform: Record<string, number>;
  
  /** Events where marketKind=MATCHUP but matchupKey is missing, or events without marketKind/matchupKey */
  matchupKeyMissingByPlatform: Record<string, number>;
  
  /** Sample matchupKeys per platform (up to 10 unique per platform) */
  sampleMatchupKeysByPlatform: Record<string, string[]>;
  
  /** Sample Kalshi titles (first 10 rawTitle for KALSHI events) */
  sampleKalshiTitles: string[];
  
  /** Field presence booleans */
  eventFieldPresence: {
    hasMarketKind: boolean;
    hasMatchupKey: boolean;
    hasNormalizedTitle: boolean;
    hasHomeTeam: boolean;
    hasAwayTeam: boolean;
  };
  
  /** Counts of events per sport */
  countsBySport: Record<string, number>;
  
  /** Sample events per platform (first 3 per platform for inspection) */
  sampleEventsByPlatform: Record<string, Array<{
    vendorMarketId: string;
    rawTitle: string;
    sport: string;
    status: string;
    homeTeam?: string;
    awayTeam?: string;
  }>>;
  
  /** Matched group summary - what eventKeys exist */
  matchedGroupEventKeys: string[];
  
  /** Snapshot age warning if > 60s */
  snapshotAgeWarning: boolean;
}

/**
 * Compute debug info from snapshot events.
 */
function computeDebugInfo(
  snapshot: LiveEventsSnapshot | null,
  snapshotAge: number | null
): LiveEventsDebugInfo {
  const events = snapshot?.registry?.events ?? [];
  
  // Initialize per-platform counters
  const platforms: LiveEventPlatform[] = ['SXBET', 'POLYMARKET', 'KALSHI'];
  const matchupCountsByPlatform: Record<string, number> = {};
  const matchupKeyMissingByPlatform: Record<string, number> = {};
  const sampleMatchupKeysByPlatform: Record<string, string[]> = {};
  const sampleEventsByPlatform: Record<string, Array<{
    vendorMarketId: string;
    rawTitle: string;
    sport: string;
    status: string;
    homeTeam?: string;
    awayTeam?: string;
  }>> = {};
  const countsBySport: Record<string, number> = {};
  
  for (const p of platforms) {
    matchupCountsByPlatform[p] = 0;
    matchupKeyMissingByPlatform[p] = 0;
    sampleMatchupKeysByPlatform[p] = [];
    sampleEventsByPlatform[p] = [];
  }
  
  // Field presence tracking
  let hasMarketKind = false;
  let hasMatchupKey = false;
  let hasNormalizedTitle = false;
  let hasHomeTeam = false;
  let hasAwayTeam = false;
  
  const sampleKalshiTitles: string[] = [];
  
  for (const event of events) {
    const platform = event.platform;
    const extra = (event as any).extra ?? {};
    const marketKind = extra.marketKind;
    const matchupKey = extra.matchupKey;
    
    // Track field presence
    if (marketKind) hasMarketKind = true;
    if (matchupKey) hasMatchupKey = true;
    if (event.normalizedTitle) hasNormalizedTitle = true;
    if (event.homeTeam) hasHomeTeam = true;
    if (event.awayTeam) hasAwayTeam = true;
    
    // Count by sport
    const sport = event.sport || 'UNKNOWN';
    countsBySport[sport] = (countsBySport[sport] || 0) + 1;
    
    // Check for MATCHUP events
    if (marketKind === 'MATCHUP') {
      matchupCountsByPlatform[platform] = (matchupCountsByPlatform[platform] || 0) + 1;
      
      if (!matchupKey) {
        matchupKeyMissingByPlatform[platform] = (matchupKeyMissingByPlatform[platform] || 0) + 1;
      } else {
        // Collect sample matchupKeys (up to 10 unique per platform)
        const existing = sampleMatchupKeysByPlatform[platform] || [];
        if (existing.length < 10 && !existing.includes(matchupKey)) {
          existing.push(matchupKey);
          sampleMatchupKeysByPlatform[platform] = existing;
        }
      }
    } else {
      // Events without marketKind or with non-MATCHUP kind
      // Count these as "missing" if they have no matchupKey
      if (!matchupKey) {
        matchupKeyMissingByPlatform[platform] = (matchupKeyMissingByPlatform[platform] || 0) + 1;
      }
    }
    
    // Sample Kalshi titles
    if (platform === 'KALSHI' && sampleKalshiTitles.length < 10) {
      sampleKalshiTitles.push(event.rawTitle);
    }
    
    // Sample events per platform (first 3)
    const platformSamples = sampleEventsByPlatform[platform] || [];
    if (platformSamples.length < 3) {
      platformSamples.push({
        vendorMarketId: event.vendorMarketId,
        rawTitle: event.rawTitle,
        sport: event.sport,
        status: event.status,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
      });
      sampleEventsByPlatform[platform] = platformSamples;
    }
  }
  
  // Extract matched group event keys
  const matchedGroupEventKeys = (snapshot?.matchedGroups ?? [])
    .slice(0, 50)
    .map(g => g.eventKey);
  
  return {
    schemaVersion: DEBUG_SCHEMA_VERSION,
    matchupCountsByPlatform,
    matchupKeyMissingByPlatform,
    sampleMatchupKeysByPlatform,
    sampleKalshiTitles,
    eventFieldPresence: {
      hasMarketKind,
      hasMatchupKey,
      hasNormalizedTitle,
      hasHomeTeam,
      hasAwayTeam,
    },
    countsBySport,
    sampleEventsByPlatform,
    matchedGroupEventKeys,
    snapshotAgeWarning: snapshotAge !== null && snapshotAge > 60000,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const runtimeConfig = await loadLiveArbRuntimeConfig();
    const { liveOnly, minPlatforms, sport, limit } = req.query;

    // Parse query params
    const filters = {
      liveOnly: liveOnly === 'true',
      minPlatforms: minPlatforms ? parseInt(minPlatforms as string, 10) : undefined,
      sport: sport as Sport | undefined,
    };

    const maxGroups = limit ? parseInt(limit as string, 10) : 100;

    // Check worker status from KV heartbeat
    const heartbeat = await getWorkerHeartbeat();
    const workerPresent = isHeartbeatFresh(heartbeat, WORKER_HEARTBEAT_STALE_MS);
    
    // Get live events snapshot from KV
    const snapshot = await getLiveEventsSnapshot();
    
    // Calculate snapshot age
    const snapshotAge = snapshot?.updatedAt 
      ? Date.now() - new Date(snapshot.updatedAt).getTime() 
      : null;
    
    // Check if enabled
    const enabled = runtimeConfig.ruleBasedMatcherEnabled;
    const running = workerPresent && heartbeat?.state === 'RUNNING';
    const config = buildLiveEventMatcherConfig();

    // Build response from KV snapshot (or empty defaults if no snapshot)
    let registryEvents = snapshot?.registry?.events ?? [];
    let matchedGroups = snapshot?.matchedGroups ?? [];
    
    // Apply filters
    if (filters.liveOnly) {
      registryEvents = registryEvents.filter(e => e.status === 'LIVE');
      matchedGroups = matchedGroups.filter(g => g.status === 'LIVE');
    }
    
    if (filters.minPlatforms) {
      matchedGroups = matchedGroups.filter(g => g.platformCount >= filters.minPlatforms!);
    }
    
    if (filters.sport) {
      registryEvents = registryEvents.filter(e => e.sport === filters.sport);
      matchedGroups = matchedGroups.filter(g => g.sport === filters.sport);
    }

    // Limit matched groups for response size
    const totalMatchedGroups = matchedGroups.length;
    if (matchedGroups.length > maxGroups) {
      matchedGroups = matchedGroups.slice(0, maxGroups);
    }

    // Count events per platform
    const countByPlatform = snapshot?.registry?.countByPlatform ?? {
      SXBET: 0,
      POLYMARKET: 0,
      KALSHI: 0,
    };
    
    const countByStatus = snapshot?.registry?.countByStatus ?? {
      PRE: 0,
      LIVE: 0,
      ENDED: 0,
    };

    // Count matched groups by platform count
    const threeWayMatches = matchedGroups.filter(g => g.platformCount >= 3).length;
    const twoWayMatches = matchedGroups.filter(g => g.platformCount === 2).length;
    
    // Group by sport
    const bySport: Record<string, number> = {};
    for (const group of matchedGroups) {
      bySport[group.sport] = (bySport[group.sport] || 0) + 1;
    }

    // Calculate uptime from heartbeat if available (not available from KV)
    const uptimeMs = 0;

    // Compute debug info for diagnosing matching issues
    const debug = computeDebugInfo(snapshot, snapshotAge);

    const response = {
      enabled,
      running,
      uptimeMs,
      workerPresent,
      snapshotAge,
      snapshotUpdatedAt: snapshot?.updatedAt ?? null,
      config: {
        enabled: config.enabled,
        sportsOnly: config.sportsOnly,
        timeToleranceMinutes: config.timeTolerance / 60000,
        minTeamSimilarity: config.minTeamSimilarity,
        maxWatchers: config.maxWatchers,
        minPlatforms: config.minPlatforms,
        registryRefreshIntervalSeconds: config.registryRefreshInterval / 1000,
        matcherIntervalSeconds: config.matcherInterval / 1000,
        preGameWindowMinutes: config.preGameWindow / 60000,
        postGameWindowMinutes: config.postGameWindow / 60000,
      },
      registry: {
        totalEvents: snapshot?.registry?.totalEvents ?? registryEvents.length,
        events: registryEvents.slice(0, 200), // Limit for response size
        countByPlatform,
        countByStatus,
        updatedAt: snapshot?.updatedAt ? new Date(snapshot.updatedAt).getTime() : 0,
      },
      matcher: {
        totalGroups: totalMatchedGroups,
        groupsReturned: matchedGroups.length,
        threeWayMatches,
        twoWayMatches,
        bySport,
        lastRunAt: snapshot?.updatedAt ? new Date(snapshot.updatedAt).getTime() : 0,
      },
      matchedGroups,
      watchers: {
        active: snapshot?.watchers?.length ?? 0,
        list: snapshot?.watchers ?? [],
        stats: {
          totalArbChecks: snapshot?.stats?.arbChecksTotal ?? 0,
          totalOpportunities: snapshot?.stats?.opportunitiesTotal ?? 0,
          avgChecksPerSecond: 0,
          avgCheckTimeMs: 0,
          maxCheckTimeMs: 0,
          totalMarketsWatched: snapshot?.watchers?.reduce((sum, w) => sum + w.marketCount, 0) ?? 0,
        },
      },
      eventsByPlatform: {
        sxbet: countByPlatform.SXBET ?? 0,
        polymarket: countByPlatform.POLYMARKET ?? 0,
        kalshi: countByPlatform.KALSHI ?? 0,
      },
      rateLimiter: {
        SXBET: {
          availableTokens: 10,
          totalRequests: 0,
          blockedRequests: 0,
          config: { maxRequestsPerSecond: 5, bucketSize: 10 },
        },
        POLYMARKET: {
          availableTokens: 10,
          totalRequests: 0,
          blockedRequests: 0,
          config: { maxRequestsPerSecond: 5, bucketSize: 10 },
        },
        KALSHI: {
          availableTokens: 10,
          totalRequests: 0,
          blockedRequests: 0,
          config: { maxRequestsPerSecond: 5, bucketSize: 10 },
        },
      },
      stats: {
        totalVendorEvents: snapshot?.stats?.totalVendorEvents ?? 0,
        liveEvents: snapshot?.stats?.liveEvents ?? 0,
        preEvents: snapshot?.stats?.preEvents ?? 0,
        endedEvents: snapshot?.stats?.endedEvents ?? 0,
        matchedGroups: totalMatchedGroups,
        activeWatchers: snapshot?.watchers?.length ?? 0,
        arbChecksTotal: snapshot?.stats?.arbChecksTotal ?? 0,
        opportunitiesTotal: snapshot?.stats?.opportunitiesTotal ?? 0,
      },
      debug,
      generatedAt: Date.now(),
    };

    res.status(200).json(response);

  } catch (error: any) {
    console.error('[API] Error fetching live events:', error);
    res.status(500).json({
      error: 'Failed to fetch live events',
      details: error.message,
    });
  }
}
