/**
 * Kalshi Live Sports Discovery
 * 
 * Efficiently discovers currently-live sports markets on Kalshi using the
 * Events endpoint with series_ticker filters. This avoids crawling all 30k+
 * markets by targeting only known sports game series.
 * 
 * Key insight from API exploration:
 * - Use /events endpoint with series_ticker filter for each sports series
 * - Use expected_expiration_time to estimate when games end
 * - Calculate estimated start time by subtracting game duration
 * - Game is LIVE if: (estimated_start - buffer) <= now <= (expected_end + buffer)
 * 
 * @see docs/KALSHI_API_LIVE_SPORTS.md
 */

import crypto from 'crypto';
import {
  KalshiEventData,
  KalshiMarketData,
  KalshiLiveEvent,
  KalshiLiveMarket,
  LiveSportsDiscoveryConfig,
  LiveSportsDiscoveryResult,
  DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG,
  KALSHI_SPORTS_SERIES,
  getKalshiGameDurationHours,
  getKalshiSportsSeriesTickers,
} from '@/types/live-sports-discovery';

// ============================================================================
// Configuration
// ============================================================================

const KALSHI_BASE_URL = process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2';
const API_SIGNATURE_PREFIX = '/trade-api/v2';

// ============================================================================
// Authentication
// ============================================================================

let cachedPrivateKey: string | null = null;

/**
 * Format the Kalshi private key for signing
 */
function formatPrivateKey(key: string): string {
  if (!key) return '';

  let formattedKey = key.trim();

  // Handle escaped newlines
  if (formattedKey.includes('\\n')) {
    formattedKey = formattedKey.replace(/\\n/g, '\n');
  }

  // Handle single-line format
  if (formattedKey.includes('-----BEGIN') && !formattedKey.includes('\n')) {
    formattedKey = formattedKey
      .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, (match) => `${match}\n`)
      .replace(/-----END (RSA )?PRIVATE KEY-----/, (match) => `\n${match}`)
      .replace(/\s+/g, '\n');
  }

  // Add headers if missing
  if (!formattedKey.includes('-----BEGIN')) {
    formattedKey = `-----BEGIN RSA PRIVATE KEY-----\n${formattedKey}\n-----END RSA PRIVATE KEY-----`;
  }

  // Convert RSA to PKCS#8 if needed
  if (formattedKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    try {
      const keyObject = crypto.createPrivateKey({
        key: formattedKey,
        format: 'pem',
        type: 'pkcs1',
      });
      formattedKey = keyObject.export({
        type: 'pkcs8',
        format: 'pem',
      }) as string;
    } catch {
      // Keep RSA format if conversion fails
    }
  }

  return formattedKey;
}

function getPrivateKey(): string {
  if (cachedPrivateKey) return cachedPrivateKey;
  cachedPrivateKey = formatPrivateKey(process.env.KALSHI_PRIVATE_KEY || '');
  return cachedPrivateKey;
}

/**
 * Sign a Kalshi API request
 */
function signRequest(timestamp: string, method: string, apiPath: string, body?: string): string {
  const privateKey = getPrivateKey();
  const message = `${timestamp}${method}${apiPath}${body || ''}`;

  const signature = crypto.sign('sha256', Buffer.from(message), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });

  return signature.toString('base64');
}

// ============================================================================
// HTTP Client
// ============================================================================

let requestCount = 0;

interface KalshiEventsResponse {
  events: KalshiEventData[];
  cursor?: string;
}

/**
 * Make an authenticated GET request to the Kalshi API
 */
async function kalshiGet<T>(
  endpoint: string,
  params: Record<string, string | number | boolean> = {}
): Promise<T> {
  const apiKey = process.env.KALSHI_API_KEY?.trim();
  const privateKey = getPrivateKey();

  if (!apiKey || !privateKey) {
    throw new Error(
      'Missing Kalshi credentials. Set KALSHI_API_KEY and KALSHI_PRIVATE_KEY environment variables.'
    );
  }

  // Build URL with query params
  const url = new URL(`${KALSHI_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, String(value));
  });

  // The path for signing must include query string
  const signaturePath = `${API_SIGNATURE_PREFIX}${endpoint}${url.search ? url.search : ''}`;
  const timestamp = Date.now().toString();
  const signature = signRequest(timestamp, 'GET', signaturePath);

  const headers: Record<string, string> = {
    'KALSHI-ACCESS-KEY': apiKey,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
  };

  requestCount++;

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Kalshi HTTP ${response.status}: ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Delay helper for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Live Detection Logic
// ============================================================================

/**
 * Check if an event is currently LIVE based on expected_expiration_time.
 * 
 * Logic:
 * - expected_expiration_time = when the game is expected to END
 * - Game is LIVE if: (expected_end - game_duration - buffer) <= now <= (expected_end + buffer)
 */
export function isLiveKalshiEvent(
  event: KalshiEventData,
  now: Date,
  config: LiveSportsDiscoveryConfig = DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG
): boolean {
  // Check nested markets for status and timing
  if (!event.markets || event.markets.length === 0) {
    return false;
  }

  const market = event.markets[0];
  
  // Market must be open/active
  const marketStatus = market.status?.toLowerCase();
  if (marketStatus !== 'open' && marketStatus !== 'active') {
    return false;
  }

  // Use expected_expiration_time as the key signal
  const expectedExpirationStr = market.expected_expiration_time;
  if (!expectedExpirationStr) {
    // Fallback: no expected_expiration_time, can't determine live status
    return false;
  }

  const expectedExpiration = new Date(expectedExpirationStr);
  if (isNaN(expectedExpiration.getTime())) {
    return false;
  }

  // Get typical game duration for this sport
  const seriesTicker = event.series_ticker || '';
  const gameDurationHours = getKalshiGameDurationHours(seriesTicker);
  const gameDurationMs = gameDurationHours * 60 * 60 * 1000;
  const bufferMs = config.liveBufferHours * 60 * 60 * 1000;

  // Calculate estimated game start time
  const estimatedStartTime = new Date(expectedExpiration.getTime() - gameDurationMs);
  
  // Game is LIVE if:
  // - We're past the estimated start time (with buffer for early starts)
  // - We're before the expected end time (with buffer for overtime)
  const nowMs = now.getTime();
  const startWindowMs = estimatedStartTime.getTime() - bufferMs;
  const endWindowMs = expectedExpiration.getTime() + bufferMs;

  return nowMs >= startWindowMs && nowMs <= endWindowMs;
}

/**
 * Check if a market is tradable
 */
function isTradableMarket(market: KalshiMarketData): boolean {
  const status = market.status?.toLowerCase();
  return status === 'open' || status === 'active';
}

/**
 * Get estimated start time for an event
 */
function getEstimatedStartTime(event: KalshiEventData): Date | null {
  const market = event.markets?.[0];
  if (!market?.expected_expiration_time) {
    return null;
  }
  
  const expectedEnd = new Date(market.expected_expiration_time);
  if (isNaN(expectedEnd.getTime())) {
    return null;
  }
  
  const seriesTicker = event.series_ticker || '';
  const gameDurationHours = getKalshiGameDurationHours(seriesTicker);
  const gameDurationMs = gameDurationHours * 60 * 60 * 1000;
  
  return new Date(expectedEnd.getTime() - gameDurationMs);
}

// ============================================================================
// Discovery Functions
// ============================================================================

/**
 * Fetch events for a specific series
 */
async function fetchEventsForSeries(
  seriesTicker: string,
  config: LiveSportsDiscoveryConfig
): Promise<KalshiEventData[]> {
  try {
    const response = await kalshiGet<KalshiEventsResponse>('/events', {
      series_ticker: seriesTicker,
      status: 'open',
      limit: config.eventsPerPage,
      with_nested_markets: 'true',
    });

    return response.events || [];
  } catch (error) {
    // Series might not exist or have no events - that's OK
    const errorStr = String(error);
    if (!errorStr.includes('404')) {
      console.warn(`[Kalshi-Discovery] ${seriesTicker}: ${error}`);
    }
    if (errorStr.includes('429')) {
      // Rate limited - wait longer
      await delay(2000);
    }
    return [];
  }
}

/**
 * Discover currently-live sports markets on Kalshi
 * 
 * This is the main entry point for Kalshi live sports discovery.
 * It queries each known sports series for events with nested markets.
 */
export async function discoverKalshiLiveSports(
  config: Partial<LiveSportsDiscoveryConfig> = {}
): Promise<LiveSportsDiscoveryResult<KalshiLiveEvent>> {
  const cfg: LiveSportsDiscoveryConfig = {
    ...DEFAULT_LIVE_SPORTS_DISCOVERY_CONFIG,
    ...config,
  };
  
  const now = new Date();
  const seriesTickers = getKalshiSportsSeriesTickers();
  
  // Reset request count for this discovery run
  requestCount = 0;
  
  // Tracking
  const allEvents: KalshiEventData[] = [];
  const seriesWithEvents: Record<string, number> = {};
  let seriesQueried = 0;
  
  console.log(`[Kalshi-Discovery] Querying ${seriesTickers.length} sports series...`);
  
  for (const seriesTicker of seriesTickers) {
    seriesQueried++;
    
    if (seriesQueried > 1) {
      await delay(cfg.requestDelayMs);
    }
    
    const events = await fetchEventsForSeries(seriesTicker, cfg);
    
    if (events.length > 0) {
      seriesWithEvents[seriesTicker] = events.length;
      allEvents.push(...events);
      console.log(`[Kalshi-Discovery] ${seriesTicker}: ${events.length} events`);
    }
  }
  
  console.log(
    `[Kalshi-Discovery] Found ${allEvents.length} total events ` +
    `across ${Object.keys(seriesWithEvents).length} series`
  );
  
  // Filter to live events
  const liveEvents = allEvents.filter(event => isLiveKalshiEvent(event, now, cfg));
  console.log(`[Kalshi-Discovery] ${liveEvents.length} events are LIVE`);
  
  // Build result
  const liveEventsResult: KalshiLiveEvent[] = liveEvents.map(event => {
    const estimatedStart = getEstimatedStartTime(event);
    const tradableMarkets = (event.markets || []).filter(isTradableMarket);
    
    return {
      event_ticker: event.event_ticker,
      title: event.title,
      series_ticker: event.series_ticker,
      status: event.status,
      strike_date: event.strike_date,
      expected_expiration_time: event.markets?.[0]?.expected_expiration_time,
      estimated_start_time: estimatedStart?.toISOString(),
      market_count: tradableMarkets.length,
      markets: tradableMarkets.map(m => ({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        title: m.title,
        status: m.status,
        series_ticker: m.series_ticker,
        expected_expiration_time: m.expected_expiration_time,
        yes_price: m.yes_price,
        no_price: m.no_price,
      })),
    };
  });
  
  // Count total markets
  const totalMarkets = liveEventsResult.reduce((sum, e) => sum + e.market_count, 0);
  
  console.log(
    `[Kalshi-Discovery] ${liveEventsResult.length} live events with ${totalMarkets} tradable markets ` +
    `(${requestCount} requests)`
  );
  
  return {
    platform: 'kalshi',
    discoveredAt: now.toISOString(),
    liveMarkets: liveEventsResult,
    counts: {
      requestsMade: requestCount,
      eventsFetched: allEvents.length,
      eventsWithStartTimeInPast: liveEvents.length,
      marketsInspected: allEvents.reduce((sum, e) => sum + (e.markets?.length || 0), 0),
      liveMarketsFound: totalMarkets,
    },
    debug: {
      seriesWithEvents,
    },
  };
}

/**
 * Check if Kalshi credentials are configured
 */
export function hasKalshiCredentials(): boolean {
  const apiKey = process.env.KALSHI_API_KEY || '';
  const privateKey = process.env.KALSHI_PRIVATE_KEY || '';
  return Boolean(apiKey && privateKey);
}

/**
 * Get the current request count (for testing/debugging)
 */
export function getKalshiRequestCount(): number {
  return requestCount;
}

/**
 * Reset the request counter
 */
export function resetKalshiRequestCount(): void {
  requestCount = 0;
}

/**
 * Get all configured sports series
 */
export function getConfiguredSportsSeries() {
  return KALSHI_SPORTS_SERIES;
}

