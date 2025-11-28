import axios from 'axios';
import crypto from 'crypto';
import { Market } from '@/types';
import { isDryFireMode } from '@/types/dry-fire';

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const API_SIGNATURE_PREFIX = '/trade-api/v2';
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

export class KalshiAPI {
  private apiKey: string;
  private privateKey: string;
  private email: string;

  constructor() {
    this.apiKey = process.env.KALSHI_API_KEY || '';
    this.privateKey = this.formatPrivateKey(process.env.KALSHI_PRIVATE_KEY || '');
    this.email = process.env.KALSHI_EMAIL || '';
  }

  private formatPrivateKey(key: string): string {
    if (!key) return '';
    
    let formattedKey = key;

    // 1. Handle escaped newlines (common in .env files)
    // Replaces literal "\n" with actual newline character
    if (formattedKey.includes('\\n')) {
      formattedKey = formattedKey.replace(/\\n/g, '\n');
    }
    
    // 2. Handle if the key was flattened to a single line without escaped newlines
    // e.g. "-----BEGIN PRIVATE KEY----- MII... -----END PRIVATE KEY-----"
    if (formattedKey.includes('-----BEGIN') && !formattedKey.includes('\n')) {
      formattedKey = formattedKey
        .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, match => `${match}\n`)
        .replace(/-----END (RSA )?PRIVATE KEY-----/, match => `\n${match}`)
        .replace(/\s+/g, '\n'); // Be careful with this, it might break the body if there are spaces
    }

    // 3. Ensure it has headers if missing (raw base64)
    if (!formattedKey.includes('-----BEGIN')) {
      // If missing headers, it's likely a raw RSA key. 
      // Use RSA PRIVATE KEY as standard wrapper for raw keys.
      formattedKey = `-----BEGIN RSA PRIVATE KEY-----\n${formattedKey}\n-----END RSA PRIVATE KEY-----`;
    }

    // 4. Try to convert RSA PRIVATE KEY (PKCS#1) to PRIVATE KEY (PKCS#8) if needed
    // Kalshi often provides RSA keys, but Node.js crypto prefers PKCS#8
    if (formattedKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
      try {
        const crypto = require('crypto');
        // Try to parse as RSA key and convert to PKCS#8
        const keyObject = crypto.createPrivateKey({
          key: formattedKey,
          format: 'pem',
          type: 'pkcs1'
        });
        // Export as PKCS#8 format
        formattedKey = keyObject.export({
          type: 'pkcs8',
          format: 'pem'
        }) as string;
      } catch (error) {
        // If conversion fails, return original
        console.error('Failed to convert RSA key to PKCS#8:', error);
      }
    }
    
    return formattedKey;
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

  private async generateAuthHeaders(method: string, path: string, body?: any): Promise<Record<string, string>> {
    const timestamp = Date.now().toString();
    
    // CRITICAL: For GET/DELETE requests, body MUST be empty string, not undefined, null, or {}
    // Kalshi signature format: ${timestamp}${METHOD}${path}${body}
    // Any deviation (including "{}", "undefined", "null", or spaces) breaks authentication
    let bodyString = '';
    if (body !== undefined && body !== null) {
      const serialized = JSON.stringify(body);
      // Only use body if it's not an empty object
      if (serialized !== '{}') {
        bodyString = serialized;
      }
    }
    
    // Create signature - EXACT format required by Kalshi
    // CRITICAL: Kalshi requires RSA-PSS signature, not PKCS#1 v1.5!
    const message = `${timestamp}${method.toUpperCase()}${path}${bodyString}`;
    
    let signature;
    try {
      // Use RSA-PSS padding as required by Kalshi API
      signature = crypto.sign('sha256', Buffer.from(message), {
        key: this.privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      });
      
      // Convert to base64
      signature = signature.toString('base64');
    } catch (error: any) {
      console.error('Error signing Kalshi request:', error.message);
      // Log key debug info (safe)
      const keyLines = this.privateKey.split('\n');
      console.error('Key format debug:', {
        length: this.privateKey.length,
        hasHeaders: this.privateKey.includes('-----BEGIN'),
        headerType: keyLines[0],
        lines: keyLines.length
      });
      throw error;
    }

    // Build headers - only include Content-Type for requests with body
    const headers: Record<string, string> = {
      'KALSHI-ACCESS-KEY': this.apiKey,
      'KALSHI-ACCESS-SIGNATURE': signature,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
    };
    
    // Only add Content-Type if we have a body
    if (bodyString) {
      headers['Content-Type'] = 'application/json';
    }
    
    return headers;
  }

  async getOpenMarkets(maxDaysToExpiry: number): Promise<Market[]> {
    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + maxDaysToExpiry);
    const window = {
      startISO: now.toISOString(),
      endISO: maxDate.toISOString(),
    };

    try {
      const markets: Market[] = [];
      let cursor: string | undefined;
      let page = 0;

      while (page < KALSHI_MAX_PAGES) {
        const { entries, nextCursor } = await this.fetchMarketsPage(cursor, window);
        page += 1;

        if (!entries.length) {
          console.info(`[Kalshi] Markets page ${page} returned 0 entries; stopping pagination.`);
          break;
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

          const yesPrice = market.yes_price;
          const noPrice = market.no_price;

          markets.push({
            id: market.ticker,
            platform: 'kalshi',
            ticker: market.ticker,
            marketType: 'prediction',
            title: market.title,
            yesPrice,
            noPrice,
            expiryDate: expiryDate.toISOString(),
            volume: market.volume,
          });
        }

        console.info(
          `[Kalshi] Processed Kalshi page ${page} (${entries.length} raw within <=${maxDaysToExpiry}d, ${markets.length} total tradable so far).`
        );

        if (!nextCursor) {
          break;
        }

        if (markets.length >= KALSHI_TARGET_MARKETS) {
          console.info(
            `[Kalshi] Reached target tradable market count (${markets.length}); stopping pagination early.`
          );
          break;
        }

        cursor = nextCursor;
      }

      if (markets.length === 0) {
        console.warn(
          `[Kalshi] No markets matched the expiry filter (<= ${maxDaysToExpiry}d) across ${page} page(s).`
        );
      }

      return markets;
    } catch (error: any) {
      console.error('Error fetching Kalshi markets:', error.response?.status || error.message);
      return [];
    }
  }

  private async fetchMarketsPage(
    cursor: string | undefined,
    window: { startISO: string; endISO: string }
  ): Promise<{ entries: KalshiMarket[]; nextCursor?: string }> {
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
      const error = '[Kalshi DRY-FIRE GUARD] Attempted to place real order in DRY_FIRE_MODE!';
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

