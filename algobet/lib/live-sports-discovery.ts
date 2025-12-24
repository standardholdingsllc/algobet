import {
  CombinedLiveSportsResult,
  LiveSportsDiscoveryResult,
  PolymarketLiveMarket,
  KalshiLiveEvent,
} from '@/types/live-sports-discovery';
import { liveArbLog } from './live-arb-logger';

/**
 * Check if Kalshi credentials are available
 */
export function hasKalshiCredentials(): boolean {
  return !!(
    process.env.KALSHI_API_KEY &&
    process.env.KALSHI_PRIVATE_KEY &&
    process.env.KALSHI_EMAIL
  );
}

/**
 * Create an empty discovery result for a platform
 */
function createEmptyResult<T>(platform: 'polymarket' | 'kalshi'): LiveSportsDiscoveryResult<T> {
  return {
    platform,
    discoveredAt: new Date().toISOString(),
    liveMarkets: [],
    counts: {
      requestsMade: 0,
      eventsFetched: 0,
      eventsWithStartTimeInPast: 0,
      marketsInspected: 0,
      liveMarketsFound: 0,
    },
  };
}

/**
 * Discover all live sports events from available platforms
 */
export async function discoverAllLiveSports(): Promise<CombinedLiveSportsResult> {
  const now = new Date();

  // For now, return empty results to avoid build errors
  // TODO: Implement actual discovery logic
  const polymarketResult = createEmptyResult<PolymarketLiveMarket>('polymarket');
  const kalshiResult = createEmptyResult<KalshiLiveEvent>('kalshi');

  const result: CombinedLiveSportsResult = {
    polymarket: polymarketResult,
    kalshi: kalshiResult,
    totalLiveMarkets: 0,
    discoveredAt: now.toISOString(),
  };

  return result;
}

/**
 * Convert discovery results to vendor events format
 */
export function discoveryResultsToVendorEvents(result: CombinedLiveSportsResult): any[] {
  const vendorEvents: any[] = [];

  // Convert Kalshi events
  if (result.kalshi?.liveMarkets) {
    vendorEvents.push(...result.kalshi.liveMarkets.map(event => ({
      ...event,
      platform: 'KALSHI',
      source: 'discovery',
    })));
  }

  // Convert Polymarket events
  if (result.polymarket?.liveMarkets) {
    vendorEvents.push(...result.polymarket.liveMarkets.map(event => ({
      ...event,
      platform: 'POLYMARKET',
      source: 'discovery',
    })));
  }

  return vendorEvents;
}

/**
 * Filter events to only include live markets
 */
export function filterToLiveMarkets(events: any[]): any[] {
  return events.filter(event => {
    // Check if the event has live status or timing
    if (event.status === 'LIVE') return true;
    if (event.isLive === true) return true;

    // Check timing - if current time is within event window
    if (event.startTime && event.endTime) {
      const now = Date.now();
      const start = new Date(event.startTime).getTime();
      const end = new Date(event.endTime).getTime();
      if (now >= start && now <= end) return true;
    }

    return false;
  });
}
