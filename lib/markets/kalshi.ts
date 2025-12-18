import axios from 'axios';
import crypto from 'crypto';
import { Market } from '@/types';
import { isDryFireMode } from '../execution-wrapper';
import {
  recordKalshi429,
  recordKalshiCacheEvent,
  recordKalshiFetchAttempted,
  recordKalshiFetchFailed,
  recordKalshiFilteredToCloseWindow,
  recordKalshiFilteredByStatus,
  recordKalshiHttpStatus,
  recordKalshiQueryApplied,
  recordKalshiRateLimitState,
  recordKalshiRawItems,
  recordPlatformFetchSkipped,
} from '../live-events-debug';
import {
  KALSHI_BACKOFF_BASE_MS,
  KALSHI_BACKOFF_MAX_MS,
  KALSHI_MARKETS_CACHE_TTL_MS,
  KALSHI_MAX_SERIES_PER_REFRESH,
  KALSHI_SERIES_CACHE_TTL_MS,
  KALSHI_SERIES_PROBE_COUNT,
  KALSHI_SERIES_REQUEST_DELAY_MS,
  TtlCache,
  getKalshiRateLimitDebug,
  getKalshiRateLimitPrimitives,
} from '../../services/kalshi-rate-limit';

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const API_SIGNATURE_PREFIX = '/trade-api/v2';
export const KALSHI_WS_SIGNATURE_PATH = '/trade-api/ws/v2';
export const DEFAULT_KALSHI_WS_URL = 'wss://api.elections.kalshi.com/trade-api/ws/v2';
const KALSHI_PAGE_LIMIT = 1000;
const parsedCloseWindowMinutes = parseInt(process.env.KALSHI_LIVE_CLOSE_WINDOW_MINUTES || '', 10);
const parsedMinCloseWindowMinutes = parseInt(
  process.env.KALSHI_MIN_CLOSE_WINDOW_MINUTES || '',
  10
);
const parsedMaxPagesPerSeries = parseInt(process.env.KALSHI_MAX_PAGES_PER_SERIES || '', 10);
const parsedMaxTotalMarkets = parseInt(process.env.KALSHI_MAX_TOTAL_MARKETS || '', 10);
export const DEFAULT_KALSHI_CLOSE_WINDOW_MINUTES = Math.max(
  1,
  Number.isFinite(parsedCloseWindowMinutes) ? parsedCloseWindowMinutes : 360
);
export const DEFAULT_KALSHI_MIN_CLOSE_WINDOW_MINUTES = Math.max(
  1,
  Number.isFinite(parsedMinCloseWindowMinutes) ? parsedMinCloseWindowMinutes : 120
);
export const DEFAULT_KALSHI_MAX_PAGES_PER_SERIES = Math.max(
  1,
  Number.isFinite(parsedMaxPagesPerSeries) ? parsedMaxPagesPerSeries : 2
);
export const DEFAULT_KALSHI_MAX_TOTAL_MARKETS = Math.max(
  100,
  Number.isFinite(parsedMaxTotalMarkets) ? parsedMaxTotalMarkets : 2000
);
export const DEFAULT_KALSHI_SERIES_CACHE_TTL_MS = KALSHI_SERIES_CACHE_TTL_MS;
const DEFAULT_SPORTS_CATEGORY = 'Sports';

interface KalshiMarket {
  ticker: string;
  title: string;
  yes_price: number;
  no_price: number;
  volume: number;
  event_ticker: string;
  close_time: string;
  series_ticker?: string;
  category?: string;
  expected_expiration_time?: string;
  expiration_time?: string;
  status?: string;
  market_type?: string;
  mve_collection_ticker?: string;
}

interface KalshiOrderbookEntry {
  price: number;
  quantity: number;
}

interface KalshiOrderbook {
  yes: [number, number][];
  no: [number, number][];
}

interface KalshiMarketsResponse {
  markets: KalshiMarket[];
  meta?: {
    next_cursor?: string;
  };
  next_cursor?: string;
  cursor?: string;
}

interface KalshiMarketQueryParams {
  minCloseTs: number;
  maxCloseTs: number;
  status?: string;
  seriesTicker?: string;
}

interface GetOpenMarketsOptions {
  maxCloseMinutes?: number;
  minCloseMinutes?: number;
  status?: string;
  sportsOnly?: boolean;
  seriesTickersOverride?: string[];
  maxPagesPerSeries?: number;
  maxTotalMarkets?: number;
}

interface KalshiSeries {
  ticker: string;
  title?: string;
  category?: string;
}

interface KalshiSeriesResponse {
  series?: KalshiSeries[];
  meta?: {
    next_cursor?: string;
  };
  cursor?: string;
  next_cursor?: string;
}

const KALSHI_EVENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const KALSHI_EVENT_PREFETCH_BATCH = 8;
const SERIES_DISCOVERY_MAX_PAGES = 5;
const SERIES_CACHE_KEY = 'kalshi:series:sports';

const KALSHI_SPORT_PREFIX_MAP: Record<string, string> = {
  KXNFL: 'NFL',
  KXCFB: 'NCAA_FB',
  KXNCAAF: 'NCAA_FB',
  KXNCAAFOOTBALL: 'NCAA_FB',
  KXNBA: 'NBA',
  KXNCAAB: 'NCAA_BB',
  KXNBAG: 'NBA',
  KXNHL: 'NHL',
  KXMLB: 'MLB',
  KXMLS: 'MLS',
  KXSOCCER: 'MLS',
  KXEPL: 'EPL',
  KXUCL: 'UCL',
  KXUFC: 'UFC',
  KXBOX: 'BOXING',
  KXTENNIS: 'TENNIS',
  KXGOLF: 'GOLF',
};

type SeriesCacheValue = { tickers: string[]; failedReason?: string | null };
type CachedResponse<T> = { data: T; status: number };
type MarketsCacheValue = CachedResponse<KalshiMarketsResponse>;
type KalshiGetOutcome<T> =
  | { kind: 'ok'; data: T; status: number; fromCache: boolean }
  | { kind: 'skipped'; reason: 'backoff_active'; status?: number };
type KalshiGetCacheType = 'series' | 'markets';

const {
  backoff: kalshiBackoffState,
  gate: kalshiRequestGate,
  seriesCache: sharedSeriesCache,
  marketsCache: sharedMarketsCache,
} = getKalshiRateLimitPrimitives();

const kalshiSeriesCache = sharedSeriesCache as TtlCache<string, SeriesCacheValue>;
const kalshiMarketsCache = sharedMarketsCache as TtlCache<string, MarketsCacheValue>;
const seriesStats = new Map<string, { lastSuccessAt?: number; lastMarketCount?: number }>();
let kalshiRefreshInFlight = false;
let kalshiDiscoveryInFlight = false;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(raw: any): number | null {
  if (!raw) return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return asNumber;
  }

  const asDate = new Date(raw);
  if (!Number.isNaN(asDate.getTime())) {
    const deltaSec = Math.ceil((asDate.getTime() - Date.now()) / 1000);
    return deltaSec > 0 ? deltaSec : null;
  }

  return null;
}

interface KalshiEventSummary {
  event_ticker: string;
  title: string;
  sub_title?: string;
  category?: string;
  series_ticker?: string;
}

interface KalshiEventApiResponse {
  event: KalshiEventSummary;
}

interface KalshiEventCacheEntry {
  event: KalshiEventSummary;
  fetchedAt: number;
}

let cachedKalshiPrivateKey: string | null = null;

function formatKalshiPrivateKey(key: string): string {
  if (!key) return '';

  let formattedKey = key.trim();

  if (formattedKey.includes('\\n')) {
    formattedKey = formattedKey.replace(/\\n/g, '\n');
  }

  if (formattedKey.includes('-----BEGIN') && !formattedKey.includes('\n')) {
    formattedKey = formattedKey
      .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, match => `${match}\n`)
      .replace(/-----END (RSA )?PRIVATE KEY-----/, match => `\n${match}`)
      .replace(/\s+/g, '\n');
  }

  if (!formattedKey.includes('-----BEGIN')) {
    formattedKey = `-----BEGIN RSA PRIVATE KEY-----\n${formattedKey}\n-----END RSA PRIVATE KEY-----`;
  }

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
    } catch (error) {
      console.error('Failed to convert RSA key to PKCS#8:', (error as Error).message);
    }
  }

  return formattedKey;
}

function getFormattedKalshiPrivateKey(): string {
  if (cachedKalshiPrivateKey) {
    return cachedKalshiPrivateKey;
  }
  cachedKalshiPrivateKey = formatKalshiPrivateKey(process.env.KALSHI_PRIVATE_KEY || '');
  return cachedKalshiPrivateKey;
}

function serializeKalshiBody(body?: any): string {
  if (body === undefined || body === null) {
    return '';
  }

  if (typeof body === 'string') {
    return body === '{}' ? '' : body;
  }

  const serialized = JSON.stringify(body);
  return serialized === '{}' ? '' : serialized;
}

export async function buildKalshiAuthHeaders(
  method: string,
  path: string,
  body?: any
): Promise<Record<string, string>> {
  const apiKey = (process.env.KALSHI_API_KEY || '').trim();
  const email = (process.env.KALSHI_EMAIL || '').trim();
  const privateKey = getFormattedKalshiPrivateKey();

  if (!apiKey || !privateKey) {
    throw new Error('Missing Kalshi API credentials');
  }

  const timestamp = Date.now().toString();
  const bodyString = serializeKalshiBody(body);
  const message = `${timestamp}${method.toUpperCase()}${path}${bodyString}`;

  let signature: string;
  try {
    signature = crypto
      .sign('sha256', Buffer.from(message), {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      })
      .toString('base64');
  } catch (error: any) {
    console.error('Error signing Kalshi request:', error.message);
    throw error;
  }

  const headers: Record<string, string> = {
    'KALSHI-ACCESS-KEY': apiKey,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
  };

  if (email) {
    headers['KALSHI-ACCESS-EMAIL'] = email;
  }

  if (bodyString) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

export class KalshiAPI {
  private apiKey: string;
  private privateKey: string;
  private email: string;
  private eventCache: Map<string, KalshiEventCacheEntry> = new Map();

  constructor() {
    this.apiKey = process.env.KALSHI_API_KEY || '';
    this.privateKey = getFormattedKalshiPrivateKey();
    this.email = process.env.KALSHI_EMAIL || '';
  }

  private async kalshiGet<T>(
    path: string,
    params?: Record<string, any>,
    cacheKey?: string,
    cacheTtlMs?: number,
    cacheType?: KalshiGetCacheType
  ): Promise<KalshiGetOutcome<T>> {
    let cacheStore: TtlCache<string, any> | null = null;
    if (cacheType === 'series') cacheStore = kalshiSeriesCache;
    if (cacheType === 'markets') cacheStore = kalshiMarketsCache;

    if (cacheStore && cacheKey) {
      const cached = cacheStore.get(cacheKey);
      if (cached) {
        recordKalshiCacheEvent(cacheType!, true);
        const cachedData = (cached as { data: T; status: number }).data ?? (cached as any);
        const cachedStatus =
          (cached as { status?: number }).status ?? (cached as any)?.status ?? 200;
        recordKalshiRateLimitState(getKalshiRateLimitDebug());
        return { kind: 'ok', data: cachedData, status: cachedStatus, fromCache: true };
      }
      recordKalshiCacheEvent(cacheType!, false);
    }

    if (kalshiBackoffState.isActive()) {
      recordPlatformFetchSkipped('kalshi', 'backoff_active');
      console.info('[Kalshi] Skipping REST call due to active backoff', {
        backoffUntilMs: kalshiBackoffState.backoffUntilMs,
      });
      recordKalshiRateLimitState(getKalshiRateLimitDebug());
      return { kind: 'skipped', reason: 'backoff_active' };
    }

    await kalshiRequestGate.wait();

    try {
      const response = await axios.get<T>(`${BASE_URL}${path}`, { params });
      kalshiBackoffState.clearOnSuccess();

      if (cacheStore && cacheKey && cacheTtlMs) {
        cacheStore.set(cacheKey, { data: response.data, status: response.status }, cacheTtlMs);
      }

      recordKalshiRateLimitState(getKalshiRateLimitDebug());
      return { kind: 'ok', data: response.data, status: response.status, fromCache: false };
    } catch (error: any) {
      const status = error?.response?.status;

      if (status === 429) {
        const retryAfterSec = parseRetryAfter(error?.response?.headers?.['retry-after']);
        const backoffMs = kalshiBackoffState.activate({
          retryAfterSec,
          baseMs: KALSHI_BACKOFF_BASE_MS,
          maxMs: KALSHI_BACKOFF_MAX_MS,
        });

        console.info(`[Kalshi] Entering HTTP 429 backoff for ${backoffMs}ms`, {
          retryAfterSec,
          backoffUntilMs: kalshiBackoffState.backoffUntilMs,
          consecutive429: kalshiBackoffState.consecutive429,
        });

        recordKalshi429({
          retryAfterSec,
          backoffUntilMs: kalshiBackoffState.backoffUntilMs,
          consecutive429: kalshiBackoffState.consecutive429,
          last429AtMs: kalshiBackoffState.last429AtMs,
        });
        recordPlatformFetchSkipped('kalshi', 'backoff_active');
        recordKalshiRateLimitState(getKalshiRateLimitDebug());
        return { kind: 'skipped', reason: 'backoff_active', status };
      }

      recordKalshiFetchFailed(status, error?.message);
      recordKalshiRateLimitState(getKalshiRateLimitDebug());
      throw error;
    }
  }

  private isMultivariateTicker(eventTicker?: string): boolean {
    return !!eventTicker && eventTicker.startsWith('KXMVE');
  }

  private isLikelySportsTicker(eventTicker?: string): boolean {
    if (!eventTicker || this.isMultivariateTicker(eventTicker)) {
      return false;
    }
    return Object.keys(KALSHI_SPORT_PREFIX_MAP).some((prefix) =>
      eventTicker.startsWith(prefix)
    );
  }

  private getSportHintFromTicker(
    eventTicker?: string,
    seriesTicker?: string
  ): string | undefined {
    if (eventTicker) {
      const prefixEntry = Object.entries(KALSHI_SPORT_PREFIX_MAP).find(([prefix]) =>
        eventTicker.startsWith(prefix)
      );
      if (prefixEntry) return prefixEntry[1];
    }

    if (seriesTicker) {
      const seriesEntry = Object.entries(KALSHI_SPORT_PREFIX_MAP).find(([prefix]) =>
        seriesTicker.startsWith(prefix)
      );
      if (seriesEntry) return seriesEntry[1];
    }

    return undefined;
  }

  private isEventCacheFresh(ticker: string): boolean {
    const cached = this.eventCache.get(ticker);
    if (!cached) return false;
    return Date.now() - cached.fetchedAt < KALSHI_EVENT_CACHE_TTL_MS;
  }

  private async fetchEventDetails(ticker: string): Promise<void> {
    try {
      const response = await axios.get<KalshiEventApiResponse>(`${BASE_URL}/events/${ticker}`);
      if (response.data?.event) {
        this.eventCache.set(ticker, {
          event: response.data.event,
          fetchedAt: Date.now(),
        });
      }
    } catch (error: any) {
      console.error(
        `[Kalshi] Failed to fetch event metadata for ${ticker}:`,
        error.response?.status || error.message
      );
    }
  }

  private async prefetchEventDetails(tickers: string[]): Promise<void> {
    const unique = Array.from(new Set(tickers.filter(Boolean)));
    const toFetch = unique.filter((ticker) => !this.isEventCacheFresh(ticker));

    for (let i = 0; i < toFetch.length; i += KALSHI_EVENT_PREFETCH_BATCH) {
      const batch = toFetch.slice(i, i + KALSHI_EVENT_PREFETCH_BATCH);
      await Promise.all(batch.map((ticker) => this.fetchEventDetails(ticker)));
    }
  }

  private parseSeriesOverride(): string[] {
    const override = process.env.KALSHI_SPORTS_SERIES_TICKERS_OVERRIDE || '';
    return override
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async fetchSportsSeriesTickers(): Promise<{ tickers: string[]; failedReason?: string | null }> {
    const cached = kalshiSeriesCache.get(SERIES_CACHE_KEY);
    if (cached) {
      recordKalshiCacheEvent('series', true);
      recordKalshiRateLimitState(getKalshiRateLimitDebug());
      return cached;
    }

    recordKalshiCacheEvent('series', false);

    if (kalshiDiscoveryInFlight) {
      recordPlatformFetchSkipped('kalshi', 'refresh_overlap');
      console.info('[Kalshi] Skipping series discovery because another run is in flight');
      recordKalshiRateLimitState(getKalshiRateLimitDebug());
      return { tickers: [], failedReason: 'discovery_in_flight' };
    }

    kalshiDiscoveryInFlight = true;

    const overrideTickers = this.parseSeriesOverride();
    let tickers: string[] = [];
    let failedReason: string | null = null;

    try {
      let cursor: string | undefined;
      let page = 0;
      const discovered = new Set<string>();

      while (page < SERIES_DISCOVERY_MAX_PAGES) {
        const response = await this.kalshiGet<KalshiSeriesResponse>(
          '/series',
          {
            category: DEFAULT_SPORTS_CATEGORY,
            limit: 200,
            cursor,
          },
          undefined,
          undefined,
          undefined
        );

        if (response.kind === 'skipped') {
          failedReason = 'backoff_active';
          tickers = overrideTickers;
          break;
        }

        const series = response.data.series || [];
        series
          .map((s) => s.ticker?.trim())
          .filter(Boolean)
          .forEach((ticker) => discovered.add(ticker!));

        const nextCursor =
          response.data.meta?.next_cursor ??
          response.data.next_cursor ??
          response.data.cursor ??
          undefined;

        page += 1;
        if (!nextCursor) break;
        cursor = nextCursor;
      }

      tickers = Array.from(discovered);

      if (!tickers.length && overrideTickers.length) {
        failedReason = 'discovery_empty_using_override';
        tickers = overrideTickers;
      } else if (!tickers.length) {
        failedReason = 'discovery_empty_no_override';
      }
    } catch (error: any) {
      failedReason = error?.message || 'series_discovery_failed';
      if (overrideTickers.length) {
        tickers = overrideTickers;
      } else {
        tickers = [];
      }
      console.error('[Kalshi] Failed to discover sports series:', error?.message || error);
    }

    const payload = { tickers, failedReason };

    if (failedReason !== 'backoff_active') {
      kalshiSeriesCache.set(SERIES_CACHE_KEY, payload, KALSHI_SERIES_CACHE_TTL_MS);
    }

    recordKalshiRateLimitState(getKalshiRateLimitDebug());
    kalshiDiscoveryInFlight = false;
    return payload;
  }

  private chooseSeriesTickers(allTickers: string[]): string[] {
    if (!allTickers.length) return [];

    const prioritized = allTickers
      .filter((ticker) => (seriesStats.get(ticker)?.lastMarketCount ?? 0) > 0)
      .sort((a, b) => {
        const aStats = seriesStats.get(a) || {};
        const bStats = seriesStats.get(b) || {};
        if ((bStats.lastSuccessAt ?? 0) !== (aStats.lastSuccessAt ?? 0)) {
          return (bStats.lastSuccessAt ?? 0) - (aStats.lastSuccessAt ?? 0);
        }
        return (bStats.lastMarketCount ?? 0) - (aStats.lastMarketCount ?? 0);
      });

    const untested = allTickers.filter((ticker) => !seriesStats.has(ticker));
    const probeCount = Math.min(
      KALSHI_SERIES_PROBE_COUNT,
      allTickers.length,
      KALSHI_MAX_SERIES_PER_REFRESH
    );
    const reservedPrimary = Math.max(0, KALSHI_MAX_SERIES_PER_REFRESH - probeCount);

    const chosen: string[] = [];
    chosen.push(...prioritized.slice(0, reservedPrimary));

    const remainingCapacity = KALSHI_MAX_SERIES_PER_REFRESH - chosen.length;
    const probes = untested.slice(0, Math.min(probeCount, remainingCapacity));
    chosen.push(...probes);

    if (chosen.length < KALSHI_MAX_SERIES_PER_REFRESH) {
      const fillerPool = [
        ...untested.slice(probes.length),
        ...allTickers.filter((ticker) => !chosen.includes(ticker)),
      ];

      for (const ticker of fillerPool) {
        if (chosen.length >= KALSHI_MAX_SERIES_PER_REFRESH) break;
        if (!chosen.includes(ticker)) {
          chosen.push(ticker);
        }
      }
    }

    return chosen.slice(0, KALSHI_MAX_SERIES_PER_REFRESH);
  }

  private mapKalshiMarket(market: KalshiMarket): Market {
    const expiryDate = new Date(market.close_time);
    const eventMeta = market.event_ticker
      ? this.eventCache.get(market.event_ticker)?.event
      : undefined;
    const sportHint = this.getSportHintFromTicker(
      market.event_ticker,
      eventMeta?.series_ticker || market.series_ticker
    );

    const vendorMetadata =
      eventMeta || sportHint || market.status || market.series_ticker
        ? {
            kalshiEvent: eventMeta,
            kalshiSportHint: sportHint,
            kalshiMarketStatus: market.status,
            kalshiSeriesTicker: market.series_ticker,
          }
        : undefined;

    return {
      id: market.ticker,
      platform: 'kalshi',
      ticker: market.ticker,
      marketType: 'prediction',
      title: eventMeta?.title || market.title,
      yesPrice: market.yes_price,
      noPrice: market.no_price,
      expiryDate: expiryDate.toISOString(),
      volume: market.volume,
      vendorMetadata,
      eventTicker: market.event_ticker,
      eventStartTime:
        market.expected_expiration_time ||
        market.expiration_time ||
        market.close_time,
    };
  }

  /**
   * Calculate Kalshi trading fee based on their fee schedule
   * Source: https://kalshi.com/docs/kalshi-fee-schedule.pdf
   * 
   * General markets: 0.07 × C × P × (1-P)
   * S&P500/NASDAQ-100: 0.035 × C × P × (1-P)
   * Maker fees: 0.0175 × C × P × (1-P)
   */
  private calculateFee(ticker: string, price: number, quantity: number, isMaker: boolean = false): number {
    const P = price / 100; // Convert cents to dollars
    const C = quantity;
    
    let feeMultiplier: number;
    
    if (isMaker) {
      // Maker fees (resting orders)
      feeMultiplier = 0.0175;
    } else if (ticker.startsWith('INX') || ticker.startsWith('NASDAQ100')) {
      // S&P500 and NASDAQ-100 markets have reduced fees
      feeMultiplier = 0.035;
    } else {
      // General markets
      feeMultiplier = 0.07;
    }
    
    // Formula: fees = round_up(multiplier × C × P × (1-P))
    const feeAmount = feeMultiplier * C * P * (1 - P);
    
    // Round up to next cent
    return Math.ceil(feeAmount * 100) / 100;
  }

  /**
   * Get the fee percentage for display/calculation purposes
   * Returns the effective fee rate based on price
   */
  private getFeePercentage(ticker: string, price: number): number {
    const P = price / 100;
    
    let feeMultiplier: number;
    if (ticker.startsWith('INX') || ticker.startsWith('NASDAQ100')) {
      feeMultiplier = 0.035;
    } else {
      feeMultiplier = 0.07;
    }
    
    // The fee as a percentage of the price paid
    // Fee formula: multiplier × P × (1-P)
    // As percentage of P: (multiplier × P × (1-P)) / P = multiplier × (1-P)
    const feePercentage = (feeMultiplier * P * (1 - P) / P) * 100;
    
    return feePercentage;
  }

  private async generateAuthHeaders(
    method: string,
    path: string,
    body?: any
  ): Promise<Record<string, string>> {
    return buildKalshiAuthHeaders(method, path, body);
  }

  async getOpenMarkets(options?: GetOpenMarketsOptions): Promise<Market[]> {
    if (kalshiRefreshInFlight) {
      recordPlatformFetchSkipped('kalshi', 'refresh_overlap');
      console.info('[Kalshi] Skipping Kalshi market refresh due to overlap');
      recordKalshiRateLimitState(getKalshiRateLimitDebug());
      return [];
    }

    kalshiRefreshInFlight = true;

    try {
      const opts: GetOpenMarketsOptions = options ?? {};
      const closeWindowMinutes = Math.max(
        1,
        opts.maxCloseMinutes ?? DEFAULT_KALSHI_CLOSE_WINDOW_MINUTES
      );
      const minCloseMinutes = Math.max(
        1,
        opts.minCloseMinutes ?? DEFAULT_KALSHI_MIN_CLOSE_WINDOW_MINUTES
      );
      const requestedStatus = opts.status ?? 'open';
      const sportsOnly = opts.sportsOnly ?? true;
      const maxPagesPerSeries = Math.max(
        1,
        opts.maxPagesPerSeries ?? DEFAULT_KALSHI_MAX_PAGES_PER_SERIES
      );
      const maxTotalMarkets = Math.max(
        1,
        opts.maxTotalMarkets ?? DEFAULT_KALSHI_MAX_TOTAL_MARKETS
      );

      const nowTs = Math.floor(Date.now() / 1000);
      const closeWindowFilteringUsed = Boolean(minCloseMinutes || closeWindowMinutes);
      const statusSentToApi =
        closeWindowFilteringUsed && requestedStatus === 'open' ? null : requestedStatus;
      const statusOmittedReason =
        statusSentToApi === null ? 'close_ts_incompatible_with_status_open' : undefined;
      const clientSideStatusFilter = requestedStatus || 'open';

      const queryWindow: KalshiMarketQueryParams = {
        minCloseTs: nowTs - minCloseMinutes * 60,
        maxCloseTs: nowTs + closeWindowMinutes * 60,
        status: statusSentToApi || undefined,
      };

      recordKalshiFetchAttempted();

      const marketsFetchedBySeries: Record<string, number> = {};
      const allMarkets: KalshiMarket[] = [];
      const rawSamples: KalshiMarket[] = [];
      const sportsEventTickers = new Set<string>();
      let totalPagesFetched = 0;
      let filteredToCloseWindow = 0;
      let filteredByStatus = 0;
      let totalRawItems = 0;
      let discoveryFailedReason: string | null | undefined;
      let backoffTriggered = false;

      let seriesTickers: Array<string | undefined> = [];
      let seriesTickersTotal = 0;
      let seriesTickersChosen: Array<string | undefined> = [];
      if (sportsOnly) {
        const { tickers, failedReason } = await this.fetchSportsSeriesTickers();
        seriesTickers = tickers;
        discoveryFailedReason = failedReason;
      }

      if (!sportsOnly) {
        seriesTickers = [undefined];
      }

      if (opts.seriesTickersOverride?.length) {
        seriesTickers = opts.seriesTickersOverride;
      }

      seriesTickersTotal = sportsOnly ? seriesTickers.filter(Boolean).length : seriesTickers.length;
      seriesTickersChosen = sportsOnly
        ? this.chooseSeriesTickers(seriesTickers.filter(Boolean) as string[])
        : seriesTickers;

      if (!seriesTickersChosen.length && !sportsOnly) {
        seriesTickersChosen = [undefined];
      }

      if (!seriesTickers.length) {
        recordKalshiQueryApplied({
          ...queryWindow,
          discoveryFailedReason: discoveryFailedReason ?? 'no_series_available',
          discoveredSeriesTickersCount: 0,
          seriesTickersUsed: [],
          seriesTickersTotal,
          seriesTickersChosen: [],
          maxSeriesPerRefresh: KALSHI_MAX_SERIES_PER_REFRESH,
          statusSentToApi,
          statusOmittedReason,
          clientSideStatusFilter,
        });
        console.warn('[Kalshi] No series tickers available for fetching markets.');
        recordKalshiRateLimitState(getKalshiRateLimitDebug());
        return [];
      }

      for (let i = 0; i < seriesTickersChosen.length; i += 1) {
        const ticker = seriesTickersChosen[i];
        if (allMarkets.length >= maxTotalMarkets || backoffTriggered) break;

        let cursor: string | undefined;
        let page = 0;
        const seriesKey = ticker || 'ALL';
        marketsFetchedBySeries[seriesKey] = 0;

        while (page < maxPagesPerSeries && allMarkets.length < maxTotalMarkets) {
          const { entries, nextCursor, status: httpStatus, skipped } = await this.fetchMarketsPage(
            cursor,
            {
              ...queryWindow,
              seriesTicker: ticker || undefined,
            }
          );

          if (skipped) {
            backoffTriggered = true;
            discoveryFailedReason = discoveryFailedReason ?? 'backoff_active';
            break;
          }

          totalRawItems += entries.length;

          recordKalshiHttpStatus(httpStatus);
          page += 1;
          totalPagesFetched += 1;

          if (!entries.length) {
            break;
          }

          if (rawSamples.length < 3) {
            rawSamples.push(...entries.slice(0, 3 - rawSamples.length));
          }

          for (const market of entries) {
            const statusLower = (market.status || '').toLowerCase();
            const isTradable = statusLower === 'open' || statusLower === 'active';
            if (!isTradable) {
              filteredByStatus += 1;
              continue;
            }

            const closeTs = Math.floor(new Date(market.close_time).getTime() / 1000);
            if (
              Number.isNaN(closeTs) ||
              closeTs > queryWindow.maxCloseTs ||
              closeTs < queryWindow.minCloseTs
            ) {
              filteredToCloseWindow += 1;
              continue;
            }

            allMarkets.push(market);
            marketsFetchedBySeries[seriesKey] += 1;

            if (this.isLikelySportsTicker(market.event_ticker)) {
              sportsEventTickers.add(market.event_ticker);
            }

            if (allMarkets.length >= maxTotalMarkets) {
              break;
            }
          }

          if (!nextCursor) {
            break;
          }

          cursor = nextCursor;
        }

        seriesStats.set(seriesKey, {
          lastSuccessAt:
            marketsFetchedBySeries[seriesKey] > 0
              ? Date.now()
              : seriesStats.get(seriesKey)?.lastSuccessAt,
          lastMarketCount: marketsFetchedBySeries[seriesKey],
        });

        if (i < seriesTickersChosen.length - 1 && !backoffTriggered) {
          await delay(KALSHI_SERIES_REQUEST_DELAY_MS);
        }
      }

      const seriesTickersUsed = seriesTickersChosen.filter(Boolean) as string[];

      recordKalshiQueryApplied({
        ...queryWindow,
        discoveredSeriesTickersCount: sportsOnly ? seriesTickersTotal : seriesTickersChosen.length,
        seriesTickersUsed: seriesTickersUsed.slice(0, 10),
        marketsFetchedBySeries,
        totalPagesFetched,
        cappedByMaxTotalMarkets: allMarkets.length >= maxTotalMarkets,
        discoveryFailedReason: discoveryFailedReason ?? null,
        seriesTickersTotal,
        seriesTickersChosen: seriesTickersUsed,
        maxSeriesPerRefresh: KALSHI_MAX_SERIES_PER_REFRESH,
        statusSentToApi,
        statusOmittedReason,
        clientSideStatusFilter,
      });

      recordKalshiRawItems(totalRawItems, rawSamples);
      recordKalshiFilteredToCloseWindow(filteredToCloseWindow);
      recordKalshiFilteredByStatus(filteredByStatus);

      if (sportsEventTickers.size > 0) {
        await this.prefetchEventDetails(Array.from(sportsEventTickers));
      }

      recordKalshiRateLimitState(getKalshiRateLimitDebug());
      return allMarkets.map((market) => this.mapKalshiMarket(market));
    } finally {
      kalshiRefreshInFlight = false;
    }
  }

  private buildMarketsCacheKey(
    cursor: string | undefined,
    query: KalshiMarketQueryParams
  ): string {
    const seriesKey = query.seriesTicker || 'ALL';
    const statusKey = query.status || 'all';
    const cursorKey = cursor || 'start';
    return `kalshi:markets:${seriesKey}:${statusKey}:${query.minCloseTs}:${query.maxCloseTs}:${cursorKey}`;
  }

  private async fetchMarketsPage(
    cursor: string | undefined,
    query: KalshiMarketQueryParams
  ): Promise<{ entries: KalshiMarket[]; nextCursor?: string; status: number; skipped?: boolean }> {
    const params: Record<string, string | number> = {
      limit: KALSHI_PAGE_LIMIT,
      min_close_ts: query.minCloseTs,
      max_close_ts: query.maxCloseTs,
    };

    if (query.status) {
      params.status = query.status;
    }

    if (query.seriesTicker) {
      params.series_ticker = query.seriesTicker;
    }

    if (cursor) {
      params.cursor = cursor;
    }

    const response = await this.kalshiGet<KalshiMarketsResponse>(
      '/markets',
      params,
      this.buildMarketsCacheKey(cursor, query),
      KALSHI_MARKETS_CACHE_TTL_MS,
      'markets'
    );

    if (response.kind === 'skipped') {
      return { entries: [], status: response.status ?? 429, skipped: true };
    }

    const nextCursor =
      response.data.meta?.next_cursor ??
      response.data.next_cursor ??
      response.data.cursor ??
      undefined;

    return {
      entries: response.data.markets ?? [],
      nextCursor,
      status: response.status,
      skipped: false,
    };
  }

  async getOrderbook(ticker: string): Promise<{ bestYesPrice: number; bestNoPrice: number }> {
    try {
      const response = await axios.get(`${BASE_URL}/markets/${ticker}/orderbook`);
      const orderbook: KalshiOrderbook = response.data.orderbook;

      // Handle null/missing orderbook data safely
      const bestYesPrice = (orderbook?.yes && orderbook.yes.length > 0) ? orderbook.yes[0][0] : 0;
      const bestNoPrice = (orderbook?.no && orderbook.no.length > 0) ? orderbook.no[0][0] : 0;

      return { bestYesPrice, bestNoPrice };
    } catch (error: any) {
      // Silently return 0 for 429 rate limits to avoid log spam
      if (error.response?.status !== 429) {
        console.error(`Error fetching orderbook for ${ticker}:`, error.response?.status || error.message);
      }
      return { bestYesPrice: 0, bestNoPrice: 0 };
    }
  }

  async getBalance(): Promise<number> {
    try {
      const path = '/portfolio/balance';
      const headers = await this.generateAuthHeaders('GET', `${API_SIGNATURE_PREFIX}${path}`);
      
      const response = await axios.get(`${BASE_URL}${path}`, { headers });
      return response.data.balance / 100; // Convert cents to dollars (available cash only)
    } catch (error: any) {
      // Never log full error - it contains API keys in headers
      console.error('Error fetching Kalshi balance:', error.response?.status || error.message);
      return 0;
    }
  }

  async getPortfolioValue(): Promise<number> {
    try {
      const path = '/portfolio/balance';
      const headers = await this.generateAuthHeaders('GET', `${API_SIGNATURE_PREFIX}${path}`);
      
      const response = await axios.get(`${BASE_URL}${path}`, { headers });
      // portfolio_value includes both cash and positions
      return (response.data.portfolio_value || response.data.balance) / 100; // Convert cents to dollars
    } catch (error: any) {
      console.error('Error fetching Kalshi portfolio value:', error.response?.status || error.message);
      return 0;
    }
  }

  async getTotalBalance(): Promise<{ totalValue: number; availableCash: number; positionsValue: number }> {
    try {
      // Get both cash and portfolio value from the same endpoint
      const cashBalance = await this.getBalance();
      const portfolioValue = await this.getPortfolioValue();
      
      console.log(`[Kalshi] ✅ Cash balance: $${cashBalance.toFixed(2)}`);
      console.log(`[Kalshi] 💼 Portfolio value: $${portfolioValue.toFixed(2)}`);
      
      // Calculate positions value
      const positionsValue = portfolioValue - cashBalance;
      
      console.log(`[Kalshi] 💰 Positions value: $${positionsValue.toFixed(2)}`);
      console.log(`[Kalshi] 💵 Total value: $${portfolioValue.toFixed(2)}`);
      
      return {
        totalValue: portfolioValue,
        availableCash: cashBalance,
        positionsValue: Math.max(0, positionsValue) // Ensure non-negative
      };
    } catch (error: any) {
      console.error('[Kalshi] ❌ Error fetching total balance:', error.response?.status || error.message);
      return { totalValue: 0, availableCash: 0, positionsValue: 0 };
    }
  }

  async placeBet(
    ticker: string,
    side: 'yes' | 'no',
    price: number,
    quantity: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    // DRY-FIRE GUARD: Never place real orders in dry-fire mode
    if (isDryFireMode()) {
      const error =
        '[Kalshi DRY-FIRE GUARD] Attempted to place real order while dry-fire mode is active.';
      console.error(error);
      return { success: false, error };
    }

    try {
      const path = '/orders';
      const body = {
        ticker,
        action: 'buy',
        side,
        type: 'limit',
        yes_price: side === 'yes' ? price : undefined,
        no_price: side === 'no' ? price : undefined,
        count: quantity,
        expiration_ts: Date.now() + 10000, // 10 second expiry for FOK
        sell_position_floor: 0,
        buy_max_cost: Math.ceil(price * quantity),
      };

      const headers = await this.generateAuthHeaders('POST', `${API_SIGNATURE_PREFIX}${path}`, body);
      
      const response = await axios.post(`${BASE_URL}${path}`, body, { headers });
      
      if (response.data.order && response.data.order.status === 'resting') {
        return { success: true, orderId: response.data.order.order_id };
      }
      
      return { success: false, error: 'Order not filled' };
    } catch (error: any) {
      console.error('Error placing Kalshi bet:', error.response?.status || error.message);
      return { success: false, error: error.message };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      const path = `/orders/${orderId}`;
      const headers = await this.generateAuthHeaders('DELETE', `${API_SIGNATURE_PREFIX}${path}`);
      
      await axios.delete(`${BASE_URL}${path}`, { headers });
      return true;
    } catch (error: any) {
      console.error('Error canceling Kalshi order:', error.response?.status || error.message);
      return false;
    }
  }

  async getPositions(): Promise<any[]> {
    try {
      const path = '/portfolio/positions';
      const headers = await this.generateAuthHeaders('GET', `${API_SIGNATURE_PREFIX}${path}`);
      
      const response = await axios.get(`${BASE_URL}${path}`, { headers });
      return response.data.positions || [];
    } catch (error: any) {
      console.error('Error fetching Kalshi positions:', error.response?.status || error.message);
      return [];
    }
  }
}

