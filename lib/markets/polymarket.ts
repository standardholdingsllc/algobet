import axios from 'axios';
import { Market } from '@/types';

const BASE_URL = 'https://clob.polymarket.com';
const GAMMA_URL = 'https://gamma-api.polymarket.com';
const DATA_API_URL = 'https://data-api.polymarket.com';

interface PolymarketMarket {
  condition_id: string;
  question: string;
  end_date_iso: string;
  tokens: {
    outcome: string;
    price: string;
    token_id: string;
  }[];
  volume: string;
}

interface PolymarketOrderBook {
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
}

export class PolymarketAPI {
  private apiKey: string;
  private privateKey: string;
  private walletAddress: string;

  constructor() {
    this.apiKey = process.env.POLYMARKET_API_KEY || '';
    this.privateKey = process.env.POLYMARKET_PRIVATE_KEY || '';
    this.walletAddress = process.env.POLYMARKET_WALLET_ADDRESS || '';
  }

  async getOpenMarkets(maxDaysToExpiry: number): Promise<Market[]> {
    try {
      const response = await axios.get(`${GAMMA_URL}/markets`, {
        params: {
          closed: false,
          limit: 200,
        },
      });

      const markets: Market[] = [];
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + maxDaysToExpiry);

      for (const market of response.data) {
        const expiryDate = new Date(market.end_date_iso);
        
        if (expiryDate <= maxDate && market.tokens.length === 2) {
          // Binary markets only
          const yesToken = market.tokens.find((t: any) => t.outcome === 'Yes' || t.outcome === 'YES');
          const noToken = market.tokens.find((t: any) => t.outcome === 'No' || t.outcome === 'NO');

          if (yesToken && noToken) {
            // Get orderbook for better pricing
            const orderbook = await this.getOrderbook(yesToken.token_id);
            
            const yesPrice = orderbook.bestBid ? parseFloat(orderbook.bestBid) * 100 : parseFloat(yesToken.price) * 100;
            const noPrice = orderbook.bestAsk ? (1 - parseFloat(orderbook.bestAsk)) * 100 : parseFloat(noToken.price) * 100;

            markets.push({
              id: market.condition_id,
              platform: 'polymarket',
              ticker: market.condition_id,
              marketType: 'prediction',
              title: market.question,
              yesPrice,
              noPrice,
              expiryDate: expiryDate.toISOString(),
              volume: parseFloat(market.volume),
            });
          }
        }
      }

      return markets;
    } catch (error) {
      console.error('Error fetching Polymarket markets:', error);
      return [];
    }
  }

  async getOrderbook(tokenId: string): Promise<{ bestBid: string | null; bestAsk: string | null }> {
    try {
      const response = await axios.get(`${BASE_URL}/book`, {
        params: {
          token_id: tokenId,
        },
      });

      const orderbook: PolymarketOrderBook = response.data;
      const bestBid = orderbook.bids.length > 0 ? orderbook.bids[0].price : null;
      const bestAsk = orderbook.asks.length > 0 ? orderbook.asks[0].price : null;

      return { bestBid, bestAsk };
    } catch (error) {
      console.error(`Error fetching orderbook for token ${tokenId}:`, error);
      return { bestBid: null, bestAsk: null };
    }
  }

  async getBalance(): Promise<number> {
    // Get available collateral balance from CLOB API
    if (!this.walletAddress) {
      console.warn('Polymarket wallet address not configured; returning 0 balance');
      return 0;
    }

    try {
      // Try CLOB API for collateral balance first
      const response = await axios.get(`${BASE_URL}/balance`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        params: {
          address: this.walletAddress,
        },
      });

      // CLOB API returns available collateral
      const balance = parseFloat(response.data.balance || response.data.collateral || '0');
      return Number.isFinite(balance) ? balance : 0;
    } catch (error: any) {
      console.error('Error fetching Polymarket collateral balance:', error.response?.status || error.message);
      // Fallback: return 0 if CLOB balance endpoint fails
      return 0;
    }
  }

  async getPositionsValue(): Promise<number> {
    // Get total value of positions from Data API
    if (!this.walletAddress) {
      return 0;
    }

    try {
      const response = await axios.get(`${DATA_API_URL}/value`, {
        params: {
          user: this.walletAddress,
        },
      });

      // The /value endpoint returns the value of positions
      const balanceEntry = Array.isArray(response.data)
        ? response.data.find((entry: any) => entry.user?.toLowerCase() === this.walletAddress.toLowerCase())
        : null;

      if (!balanceEntry) {
        return 0;
      }

      const value = parseFloat(balanceEntry.value);
      return Number.isFinite(value) ? value : 0;
    } catch (error) {
      console.error('Error fetching Polymarket positions value:', error);
      return 0;
    }
  }

  async getTotalBalance(): Promise<{ totalValue: number; availableCash: number; positionsValue: number }> {
    if (!this.walletAddress) {
      console.warn('[Polymarket] ⚠️ Wallet address not configured');
      return { totalValue: 0, availableCash: 0, positionsValue: 0 };
    }

    try {
      // Get available collateral (cash) from CLOB API
      const availableCash = await this.getBalance();
      console.log(`[Polymarket] ✅ Available collateral (cash): $${availableCash.toFixed(2)}`);
      
      // Get positions value from Data API
      const positionsValue = await this.getPositionsValue();
      console.log(`[Polymarket] 💰 Positions value: $${positionsValue.toFixed(2)}`);
      
      // Total value = cash + positions
      const totalValue = availableCash + positionsValue;
      console.log(`[Polymarket] 💵 Total account value: $${totalValue.toFixed(2)}`);
      
      return {
        totalValue: totalValue,
        availableCash: availableCash,
        positionsValue: positionsValue
      };
    } catch (error: any) {
      console.error('[Polymarket] ❌ Error fetching total balance:', error.message);
      return { totalValue: 0, availableCash: 0, positionsValue: 0 };
    }
  }

  async placeBet(
    tokenId: string,
    side: 'yes' | 'no',
    price: number,
    size: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      // Convert price to decimal (0-1)
      const priceDecimal = price / 100;

      const order = {
        token_id: tokenId,
        price: priceDecimal.toString(),
        size: size.toString(),
        side: side === 'yes' ? 'BUY' : 'SELL',
        type: 'FOK', // Fill or Kill
      };

      const response = await axios.post(`${BASE_URL}/order`, order, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.data.order_id) {
        return { success: true, orderId: response.data.order_id };
      }

      return { success: false, error: 'Order not filled' };
    } catch (error: any) {
      console.error('Error placing Polymarket bet:', error);
      return { success: false, error: error.message };
    }
  }

  async getPositions(): Promise<any[]> {
    try {
      // Use Data API instead of Gamma API for positions
      const response = await axios.get(`${DATA_API_URL}/positions`, {
        params: {
          user: this.walletAddress,
        },
      });

      return response.data || []; // Data API returns array of positions
    } catch (error: any) {
      console.error('Error fetching Polymarket positions:', error.response?.status || error.message);
      return [];
    }
  }
}

