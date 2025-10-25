import axios from 'axios';
import { Market } from '@/types';
import { KALSHI_API_BASE, KALSHI_FEE } from '@/lib/constants';

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

export class KalshiService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.KALSHI_API_KEY || '';
    this.baseUrl = KALSHI_API_BASE;
  }

  async getOpenMarkets(): Promise<Market[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/markets`, {
        params: {
          status: 'open',
          limit: 200,
        },
      });

      const markets: KalshiMarket[] = response.data.markets || [];
      return markets.map(this.transformMarket);
    } catch (error) {
      console.error('Error fetching Kalshi markets:', error);
      return [];
    }
  }

  async getMarketsByExpiry(maxDays: number): Promise<Market[]> {
    const allMarkets = await this.getOpenMarkets();
    const now = new Date();
    const maxDate = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);

    return allMarkets.filter(market => new Date(market.expiryDate) <= maxDate);
  }

  async getOrderbook(ticker: string): Promise<{ yes: number, no: number } | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/markets/${ticker}/orderbook`);
      const orderbook = response.data.orderbook;

      // Get best bid prices
      const yesBid = orderbook.yes?.[0]?.[0] || 0;
      const noBid = orderbook.no?.[0]?.[0] || 0;

      return {
        yes: yesBid,
        no: noBid,
      };
    } catch (error) {
      console.error(`Error fetching Kalshi orderbook for ${ticker}:`, error);
      return null;
    }
  }

  async placeOrder(
    ticker: string,
    side: 'yes' | 'no',
    amount: number,
    price: number
  ): Promise<string | null> {
    try {
      // Note: This requires authentication with private key
      // Implementation depends on Kalshi's authentication method
      const response = await axios.post(
        `${this.baseUrl}/portfolio/orders`,
        {
          ticker,
          action: 'buy',
          side,
          count: Math.floor(amount / (price / 100)), // Convert to contracts
          type: 'limit',
          yes_price: side === 'yes' ? price : undefined,
          no_price: side === 'no' ? price : undefined,
          expiration_ts: Date.now() + 5000, // 5 second expiry for Fill or Kill
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      return response.data.order?.order_id || null;
    } catch (error) {
      console.error('Error placing Kalshi order:', error);
      return null;
    }
  }

  async getBalance(): Promise<number> {
    try {
      const response = await axios.get(`${this.baseUrl}/portfolio/balance`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      return response.data.balance / 100; // Convert cents to dollars
    } catch (error) {
      console.error('Error fetching Kalshi balance:', error);
      return 0;
    }
  }

  private transformMarket(kalshiMarket: KalshiMarket): Market {
    return {
      id: kalshiMarket.ticker,
      platform: 'kalshi',
      ticker: kalshiMarket.ticker,
      marketType: 'prediction',
      title: kalshiMarket.title,
      expiryDate: new Date(kalshiMarket.close_time).toISOString(),
      yesPrice: kalshiMarket.yes_price || 0,
      noPrice: kalshiMarket.no_price || 0,
      volume: kalshiMarket.volume || 0,
    };
  }

  static calculateFees(amount: number, profit: number): number {
    // Kalshi charges 7% on profits only
    return profit * (KALSHI_FEE / 100);
  }
}

