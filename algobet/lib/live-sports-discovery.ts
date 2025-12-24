import { CombinedLiveSportsResult } from '@/types/live-sports-discovery';
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
 * Discover all live sports events from available platforms
 */
export async function discoverAllLiveSports(): Promise<CombinedLiveSportsResult> {
  const startTime = Date.now();
  const result: CombinedLiveSportsResult = {
    timestamp: new Date().toISOString(),
    duration: 0,
  };

  // For now, return empty results to avoid build errors
  // TODO: Implement actual discovery logic
  result.kalshi = {
    events: [],
  };

  result.polymarket = {
    events: [],
  };

  result.duration = Date.now() - startTime;
  return result;
}

/**
 * Convert discovery results to vendor events format
 */
export function discoveryResultsToVendorEvents(result: CombinedLiveSportsResult): any[] {
  const vendorEvents: any[] = [];

  // Convert Kalshi events
  if (result.kalshi?.events) {
    vendorEvents.push(...result.kalshi.events.map(event => ({
      ...event,
      platform: 'kalshi',
      source: 'discovery',
    })));
  }

  // Convert Polymarket events
  if (result.polymarket?.events) {
    vendorEvents.push(...result.polymarket.events.map(event => ({
      ...event,
      platform: 'polymarket',
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
