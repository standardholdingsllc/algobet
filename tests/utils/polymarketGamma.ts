/**
 * Polymarket Gamma API Helper
 * 
 * A lightweight client for the Polymarket Gamma API used for live sports market discovery.
 * This is a test utility - not production code.
 * 
 * API Documentation: https://docs.polymarket.com/developers/gamma-markets-api/overview
 * 
 * Key findings from API exploration:
 * - Use `event_date` filter to get sports events for a specific day
 * - Events have `startTime` field indicating when the game starts
 * - Markets have `gameStartTime` and `sportsMarketType` for sports identification
 * - `fpmmLive` is NOT used for live detection
 * - `acceptingOrders=true` on all active markets (not a live indicator)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Base URL for Gamma API - can be overridden via env */
const GAMMA_BASE_URL = process.env.POLY_GAMMA_URL || 'https://gamma-api.polymarket.com';

/** Request timeout in ms */
const REQUEST_TIMEOUT_MS = 30000;

/** Delay between requests to avoid rate limiting */
const REQUEST_DELAY_MS = 100;

// ============================================================================
// TYPES
// ============================================================================

export interface GammaSport {
  id: number;
  sport: string;  // Short code like 'nfl', 'nba', 'epl'
  image?: string;
  resolution?: string;
  ordering?: string;
  tags?: string;  // Comma-separated tag IDs
  series?: string;
  createdAt?: string;
}

export interface GammaTag {
  id: string;
  label: string;
  slug?: string;
  forceShow?: boolean;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  
  // Tradability flags
  active: boolean;
  closed: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  acceptingOrders?: boolean;
  
  // Live indicators (note: fpmmLive is NOT reliable)
  fpmmLive?: boolean;
  secondsDelay?: number;
  
  // Timing fields
  endDate?: string;
  endDateIso?: string;
  startDate?: string;
  startDateIso?: string;
  eventStartTime?: string;
  gameStartTime?: string;  // KEY: When the game starts
  
  // Sports-specific fields
  gameId?: string;
  sportsMarketType?: string;  // KEY: 'moneyline', 'spreads', 'totals', etc.
  
  // Pricing
  outcomes?: string;       // JSON-encoded array of outcome names
  outcomePrices?: string;  // JSON-encoded array of prices
  clobTokenIds?: string;   // comma-separated list of token_ids
  
  // Category
  category?: string;
  tags?: GammaTag[];
}

export interface GammaEvent {
  id: string;
  title: string;
  slug?: string;
  ticker?: string;
  description?: string;
  
  // Status flags
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  
  // Timing - KEY fields for live detection
  startDate?: string;
  startTime?: string;     // KEY: When the game/event starts (ISO timestamp)
  eventDate?: string;     // KEY: Date of the event (YYYY-MM-DD)
  endDate?: string;
  
  // Live indicators
  gameStatus?: string;    // Not reliably populated
  
  // Nested markets
  markets?: GammaMarket[];
  
  // Tags
  tags?: GammaTag[];
  
  // Series info
  series?: GammaSeries[];
  seriesSlug?: string;
}

export interface GammaSeries {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  seriesType?: string;
  recurrence?: string;
  image?: string;
  icon?: string;
  active?: boolean;
  closed?: boolean;
}

export interface GammaEventsResponse {
  events?: GammaEvent[];
  data?: GammaEvent[];
  // Pagination
  limit?: number;
  offset?: number;
  count?: number;
}

// ============================================================================
// HTTP HELPER
// ============================================================================

let requestCount = 0;

/**
 * Make a GET request to the Gamma API.
 * 
 * @param path - API path (e.g., '/sports', '/events')
 * @param params - Query parameters
 * @returns Parsed JSON response
 * @throws Error on non-2xx response
 */
export async function gammaGet<T>(
  path: string,
  params: Record<string, string | number | boolean> = {}
): Promise<T> {
  const url = new URL(path, GAMMA_BASE_URL);
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, String(value));
    }
  });

  requestCount++;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AlgoBet-LiveDiscovery/1.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read response body');
      throw new Error(
        `Gamma API HTTP ${response.status} ${response.statusText}: ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Gamma API request timed out after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    }
    throw error;
  }
}

/**
 * Helper to delay between requests.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the current request count (for assertions).
 */
export function getRequestCount(): number {
  return requestCount;
}

/**
 * Reset the request counter.
 */
export function resetRequestCount(): void {
  requestCount = 0;
}

/**
 * Get the configured base URL.
 */
export function getBaseUrl(): string {
  return GAMMA_BASE_URL;
}

/**
 * Get the request delay constant.
 */
export function getRequestDelay(): number {
  return REQUEST_DELAY_MS;
}

/**
 * Get today's date in YYYY-MM-DD format (UTC).
 */
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Parse a date string to Date object, handling various formats.
 */
export function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Sport code to human-readable name mapping.
 */
export const SPORT_CODE_TO_NAME: Record<string, string> = {
  'ncaab': 'NCAA Basketball',
  'epl': 'English Premier League',
  'lal': 'La Liga',
  'nfl': 'NFL',
  'nba': 'NBA',
  'nhl': 'NHL',
  'mlb': 'MLB',
  'cfb': 'College Football',
  'ufc': 'UFC',
  'mma': 'MMA',
  'ten': 'Tennis',
  'golf': 'Golf',
  'mls': 'MLS',
  'wnba': 'WNBA',
  'bun': 'Bundesliga',
  'fl1': 'Ligue 1',
  'sea': 'Serie A',
  'ucl': 'Champions League',
  'ere': 'Eredivisie',
  'ipl': 'IPL Cricket',
};
