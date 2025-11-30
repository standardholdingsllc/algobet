/**
 * Live Arb Status API
 *
 * GET /api/live-arb/status
 *
 * Returns comprehensive status of the live arbitrage system including:
 * - Overall enabled/ready state
 * - Per-platform WebSocket connection status
 * - Price cache statistics
 * - Circuit breaker state
 * - Blocked opportunity counts
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getLiveArbStatus, isLiveArbActive } from '@/lib/live-arb-integration';
import { loadLiveArbRuntimeConfig } from '@/lib/live-arb-runtime-config';
import { LivePriceCache } from '@/lib/live-price-cache';
import { LiveArbManager } from '@/lib/live-arb-manager';

interface LiveArbStatusResponse {
  liveArbEnabled: boolean;
  liveArbReady: boolean;
  timestamp: string;
  platforms: {
    sxbet: PlatformStatus;
    polymarket: PlatformStatus;
    kalshi: PlatformStatus;
  };
  priceCacheStats: {
    totalEntries: number;
    entriesByPlatform: Record<string, number>;
    totalPriceUpdates: number;
    oldestUpdateMs?: number;
    newestUpdateMs?: number;
  };
  circuitBreaker: {
    isOpen: boolean;
    consecutiveFailures: number;
    openReason?: string;
    openedAt?: string;
  };
  subscriptionStats: {
    lastUpdateAt?: string;
    updateCount: number;
    currentSubscriptions: Record<string, number>;
    blockedOpportunities: number;
    blockedReasons: Record<string, number>;
  };
}

interface PlatformStatus {
  connected: boolean;
  state: string;
  lastMessageAt: string | null;
  subscribedMarkets: number;
  errorMessage?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LiveArbStatusResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const runtimeConfig = await loadLiveArbRuntimeConfig();
    // Get overall status
    const status = getLiveArbStatus();
    const wsStatuses = LiveArbManager.getWsStatuses();
    const subscriptionStats = LiveArbManager.getSubscriptionStats();

    // Build platform status
    const platforms: LiveArbStatusResponse['platforms'] = {
      sxbet: formatPlatformStatus(wsStatuses.sxbet),
      polymarket: formatPlatformStatus(wsStatuses.polymarket),
      kalshi: formatPlatformStatus(wsStatuses.kalshi),
    };

    // Get price cache stats
    const cacheStats = LivePriceCache.getStats();
    const pricesByPlatform = LivePriceCache.getPriceCountByPlatform();
    const allPrices = LivePriceCache.getAllPrices();

    // Calculate age range
    let oldestUpdateMs: number | undefined;
    let newestUpdateMs: number | undefined;
    
    for (const price of allPrices) {
      const ageMs = price.ageMs ?? 0;
      if (oldestUpdateMs === undefined || ageMs > oldestUpdateMs) {
        oldestUpdateMs = ageMs;
      }
      if (newestUpdateMs === undefined || ageMs < newestUpdateMs) {
        newestUpdateMs = ageMs;
      }
    }

    const response: LiveArbStatusResponse = {
      liveArbEnabled: runtimeConfig.liveArbEnabled,
      liveArbReady: status.ready,
      timestamp: new Date().toISOString(),
      platforms,
      priceCacheStats: {
        totalEntries: cacheStats.priceCacheSize,
        entriesByPlatform: pricesByPlatform,
        totalPriceUpdates: cacheStats.totalPriceUpdates,
        oldestUpdateMs,
        newestUpdateMs,
      },
      circuitBreaker: {
        isOpen: status.safetyStatus.circuitBreakerOpen,
        consecutiveFailures: status.safetyStatus.circuitBreakerState.consecutiveFailures,
        openReason: status.safetyStatus.circuitBreakerState.openReason,
        openedAt: status.safetyStatus.circuitBreakerState.openedAt,
      },
      subscriptionStats: {
        lastUpdateAt: subscriptionStats.lastUpdateAt,
        updateCount: subscriptionStats.updateCount,
        currentSubscriptions: subscriptionStats.currentSubscriptions,
        blockedOpportunities: subscriptionStats.blockedOpportunities,
        blockedReasons: subscriptionStats.blockedReasons,
      },
    };

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('[API] /api/live-arb/status error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function formatPlatformStatus(status: any): PlatformStatus {
  if (!status) {
    return {
      connected: false,
      state: 'not_initialized',
      lastMessageAt: null,
      subscribedMarkets: 0,
    };
  }

  return {
    connected: status.state === 'connected',
    state: status.state,
    lastMessageAt: status.lastMessageAt || null,
    subscribedMarkets: status.subscribedMarkets || 0,
    errorMessage: status.errorMessage,
  };
}

