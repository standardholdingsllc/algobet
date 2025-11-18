import axios from 'axios';
import crypto from 'crypto';
import { Market } from '@/types';

const BASE_URL = 'https://api.kalshi.com/trade-api/v2';
const API_SIGNATURE_PREFIX = '/trade-api/v2';

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
    
    // Handle escaped newlines (common in .env files)
    let formattedKey = key.replace(/\\n/g, '\n');
    
    // Ensure it has the correct headers if missing (assuming RSA key)
    if (!formattedKey.includes('-----BEGIN')) {
      formattedKey = `-----BEGIN PRIVATE KEY-----\n${formattedKey}\n-----END PRIVATE KEY-----`;
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
    const bodyString = body ? JSON.stringify(body) : '';
    
    // Create signature
    const message = `${timestamp}${method}${path}${bodyString}`;
    const signer = crypto.createSign('SHA256');
    signer.update(message);
    signer.end();
    const signature = signer.sign(this.privateKey, 'base64');

    return {
      'Content-Type': 'application/json',
      'KALSHI-ACCESS-KEY': this.apiKey,
      'KALSHI-ACCESS-SIGNATURE': signature,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
    };
  }

  async getOpenMarkets(maxDaysToExpiry: number): Promise<Market[]> {
    try {
      const response = await axios.get(`${BASE_URL}/markets`, {
        params: {
          status: 'open',
          limit: 200,
        },
      });

      const markets: Market[] = [];
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + maxDaysToExpiry);

      for (const market of response.data.markets) {
        const expiryDate = new Date(market.close_time);
        
        if (expiryDate <= maxDate) {
          // Get orderbook for better pricing
          const orderbook = await this.getOrderbook(market.ticker);
          
          const yesPrice = orderbook.bestYesPrice || market.yes_price;
          const noPrice = orderbook.bestNoPrice || market.no_price;
          
          // Calculate actual fee percentage for this market and price
          // Store the midpoint fee for display (actual fee varies by side)
          const avgPrice = (yesPrice + noPrice) / 2;
          const feePercentage = this.getFeePercentage(market.ticker, avgPrice);
          
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
      }

      return markets;
    } catch (error) {
      console.error('Error fetching Kalshi markets:', error);
      return [];
    }
  }

  async getOrderbook(ticker: string): Promise<{ bestYesPrice: number; bestNoPrice: number }> {
    try {
      const response = await axios.get(`${BASE_URL}/markets/${ticker}/orderbook`);
      const orderbook: KalshiOrderbook = response.data.orderbook;

      const bestYesPrice = orderbook.yes.length > 0 ? orderbook.yes[0][0] : 0;
      const bestNoPrice = orderbook.no.length > 0 ? orderbook.no[0][0] : 0;

      return { bestYesPrice, bestNoPrice };
    } catch (error) {
      console.error(`Error fetching orderbook for ${ticker}:`, error);
      return { bestYesPrice: 0, bestNoPrice: 0 };
    }
  }

  async getBalance(): Promise<number> {
    try {
      const path = '/portfolio/balance';
      const headers = await this.generateAuthHeaders('GET', `${API_SIGNATURE_PREFIX}${path}`);
      
      const response = await axios.get(`${BASE_URL}${path}`, { headers });
      return response.data.balance / 100; // Convert cents to dollars
    } catch (error) {
      console.error('Error fetching Kalshi balance:', error);
      return 0;
    }
  }

  async placeBet(
    ticker: string,
    side: 'yes' | 'no',
    price: number,
    quantity: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
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
      console.error('Error placing Kalshi bet:', error);
      return { success: false, error: error.message };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      const path = `/orders/${orderId}`;
      const headers = await this.generateAuthHeaders('DELETE', `${API_SIGNATURE_PREFIX}${path}`);
      
      await axios.delete(`${BASE_URL}${path}`, { headers });
      return true;
    } catch (error) {
      console.error('Error canceling Kalshi order:', error);
      return false;
    }
  }

  async getPositions(): Promise<any[]> {
    try {
      const path = '/portfolio/positions';
      const headers = await this.generateAuthHeaders('GET', `${API_SIGNATURE_PREFIX}${path}`);
      
      const response = await axios.get(`${BASE_URL}${path}`, { headers });
      return response.data.positions || [];
    } catch (error) {
      console.error('Error fetching Kalshi positions:', error);
      return [];
    }
  }
}

