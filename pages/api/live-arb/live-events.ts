/**
 * API Endpoint: GET /api/live-arb/live-events
 *
 * Returns the current state of the rule-based live sports matcher system.
 * Includes:
 * - Configuration snapshot
 * - Registry snapshot (all tracked vendor events)
 * - Matched event groups (cross-platform matches)
 * - Active watchers with timing stats
 * - Rate limiter status
 * - Statistics
 *
 * Query Parameters:
 * - liveOnly: Only return live events (not pre-game)
 * - minPlatforms: Minimum platforms for matched groups (default: 2)
 * - sport: Filter by sport (e.g., NBA, NFL)
 * - limit: Maximum number of matched groups to return
 */

import { NextApiRequest, NextApiResponse } from 'next';
import {
  getOrchestratorStatus,
  isLiveSportsMatcherEnabled,
  isOrchestratorRunning,
  getUptimeMs,
} from '@/lib/live-sports-orchestrator';
import { getSnapshot, getRegistryStats } from '@/lib/live-event-registry';
import { getMatchedEvents, getMatcherStats } from '@/lib/live-event-matcher';
import { getActiveWatchers, getWatcherStats } from '@/lib/live-event-watchers';
import { getRateLimiterStats } from '@/lib/rate-limiter';
import { Sport, buildLiveEventMatcherConfig } from '@/types/live-events';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { liveOnly, minPlatforms, sport, limit } = req.query;

    // Parse query params
    const filters = {
      liveOnly: liveOnly === 'true',
      minPlatforms: minPlatforms ? parseInt(minPlatforms as string, 10) : undefined,
      sport: sport as Sport | undefined,
    };

    const maxGroups = limit ? parseInt(limit as string, 10) : 100;

    // Check if enabled
    const enabled = isLiveSportsMatcherEnabled();
    const running = isOrchestratorRunning();
    const uptimeMs = getUptimeMs();
    const config = buildLiveEventMatcherConfig();

    // Get data
    const registrySnapshot = getSnapshot();
    let matchedGroups = getMatchedEvents({
      liveOnly: filters.liveOnly,
      minPlatforms: filters.minPlatforms,
      sport: filters.sport,
    });

    // Limit matched groups for response size
    const totalMatchedGroups = matchedGroups.length;
    if (matchedGroups.length > maxGroups) {
      matchedGroups = matchedGroups.slice(0, maxGroups);
    }

    const watchers = getActiveWatchers();
    const registryStats = getRegistryStats();
    const watcherStats = getWatcherStats();
    const matcherStats = getMatcherStats();
    const rateLimiterStats = getRateLimiterStats();

    // Count events per platform
    const eventsByPlatform = {
      sxbet: registryStats.byPlatform.SXBET,
      polymarket: registryStats.byPlatform.POLYMARKET,
      kalshi: registryStats.byPlatform.KALSHI,
    };

    // Count matched groups by platform count
    const threeWayMatches = matchedGroups.filter(g => g.platformCount >= 3).length;
    const twoWayMatches = matchedGroups.filter(g => g.platformCount === 2).length;

    const response = {
      enabled,
      running,
      uptimeMs,
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
        totalEvents: registrySnapshot.events.length,
        events: registrySnapshot.events.slice(0, 200), // Limit for response size
        countByPlatform: registrySnapshot.countByPlatform,
        countByStatus: registrySnapshot.countByStatus,
        updatedAt: registrySnapshot.updatedAt,
      },
      matcher: {
        totalGroups: totalMatchedGroups,
        groupsReturned: matchedGroups.length,
        threeWayMatches,
        twoWayMatches,
        bySport: matcherStats.bySport,
        lastRunAt: matcherStats.lastRunAt,
      },
      matchedGroups,
      watchers: {
        active: watchers.length,
        list: watchers,
        stats: {
          totalArbChecks: watcherStats.totalArbChecks,
          totalOpportunities: watcherStats.totalOpportunities,
          avgChecksPerSecond: watcherStats.avgChecksPerSecond,
          avgCheckTimeMs: watcherStats.avgCheckTimeMs,
          maxCheckTimeMs: watcherStats.maxCheckTimeMs,
          totalMarketsWatched: watcherStats.totalMarketsWatched,
        },
      },
      eventsByPlatform,
      rateLimiter: rateLimiterStats,
      stats: {
        totalVendorEvents: registryStats.totalEvents,
        liveEvents: registryStats.byStatus.LIVE,
        preEvents: registryStats.byStatus.PRE,
        endedEvents: registryStats.byStatus.ENDED,
        matchedGroups: totalMatchedGroups,
        activeWatchers: watchers.length,
        arbChecksTotal: watcherStats.totalArbChecks,
        opportunitiesTotal: watcherStats.totalOpportunities,
      },
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
