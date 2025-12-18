import axios from 'axios';
import crypto from 'crypto';
import { Market } from '@/types';
import { isDryFireMode } from '../execution-wrapper';
import {
  recordKalshiFetchAttempted,
  recordKalshiFetchFailed,
  recordKalshiFiltered,
  recordKalshiHttpStatus,
  recordKalshiParsedEvent,
  recordKalshiRawItems,
} from '../live-events-debug';

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const API_SIGNATURE_PREFIX = '/trade-api/v2';
export const KALSHI_WS_SIGNATURE_PATH = '/trade-api/ws/v2';
export const DEFAULT_KALSHI_WS_URL = 'wss://api.elections.kalshi.com/trade-api/ws/v2';
const KALSHI_PAGE_LIMIT = 200;
const KALSHI_MAX_PAGES = 8;
const KALSHI_TARGET_MARKETS = 150;

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

const KALSHI_EVENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const KALSHI_EVENT_PREFETCH_BATCH = 8;

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

  async getOpenMarkets(maxDaysToExpiry: number): Promise<Market[]> {
    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + maxDaysToExpiry);
    const window = {
      startISO: now.toISOString(),
      endISO: maxDate.toISOString(),
    };

    recordKalshiFetchAttempted();
    const rawSamples: KalshiMarket[] = [];
    let rawSeenCount = 0;

    try {
      const rawMarkets: KalshiMarket[] = [];
      const sportsEventTickers = new Set<string>();
      let cursor: string | undefined;
      let page = 0;

      while (page < KALSHI_MAX_PAGES) {
        const { entries, nextCursor, status } = await this.fetchMarketsPage(cursor, window);
        recordKalshiHttpStatus(status);
        page += 1;

        if (!entries.length) {
          console.info(`[Kalshi] Markets page ${page} returned 0 entries; stopping pagination.`);
          break;
        }

        rawSeenCount += entries.length;
        if (rawSamples.length < 3) {
          rawSamples.push(...entries.slice(0, 3 - rawSamples.length));
        }

        for (const market of entries) {
          const expiryDate = new Date(market.close_time);
          if (
            Number.isNaN(expiryDate.getTime()) ||
            expiryDate > maxDate ||
            expiryDate < now
          ) {
            continue;
          }

          rawMarkets.push(market);

          if (this.isLikelySportsTicker(market.event_ticker)) {
            sportsEventTickers.add(market.event_ticker);
          }
        }

        console.info(
          `[Kalshi] Processed Kalshi page ${page} (${entries.length} raw within <=${maxDaysToExpiry}d, ${rawMarkets.length} total tradable so far).`
        );

        if (!nextCursor) {
          break;
        }

        if (rawMarkets.length >= KALSHI_TARGET_MARKETS) {
          console.info(
            `[Kalshi] Reached target tradable market count (${rawMarkets.length}); stopping pagination early.`
          );
          break;
        }

        cursor = nextCursor;
      }

      if (rawMarkets.length === 0) {
        console.warn(
          `[Kalshi] No markets matched the expiry filter (<= ${maxDaysToExpiry}d) across ${page} page(s).`
        );
      }

      recordKalshiRawItems(rawSeenCount, rawSamples);

      if (sportsEventTickers.size > 0) {
        await this.prefetchEventDetails(Array.from(sportsEventTickers));
      }

      const markets: Market[] = rawMarkets.map((market) => this.mapKalshiMarket(market));
      return markets;
    } catch (error: any) {
      console.error('Error fetching Kalshi markets:', error.response?.status || error.message);
      recordKalshiFetchFailed(error.response?.status, error.message);
      return [];
    }
  }

  private async fetchMarketsPage(
    cursor: string | undefined,
    window: { startISO: string; endISO: string }
  ): Promise<{ entries: KalshiMarket[]; nextCursor?: string; status: number }> {
    const startDate = new Date(window.startISO);
    const endDate = new Date(window.endISO);
    const startUnix = Math.floor(startDate.getTime() / 1000);
    const endUnix = Math.floor(endDate.getTime() / 1000);

    const params: Record<string, string | number> = {
      limit: KALSHI_PAGE_LIMIT,
      min_close_ts: startUnix,
      max_close_ts: endUnix,
    };

    if (cursor) {
      params.cursor = cursor;
    }

    const response = await axios.get<KalshiMarketsResponse>(`${BASE_URL}/markets`, {
      params,
    });

    const nextCursor =
      response.data.meta?.next_cursor ??
      response.data.next_cursor ??
      response.data.cursor ??
      undefined;

    return {
      entries: response.data.markets ?? [],
      nextCursor,
      status: response.status,
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

