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
    // For Polymarket, getBalance returns total value (cash + positions)
    // Use getTotalBalance() to get detailed breakdown
    if (!this.walletAddress) {
      console.warn('Polymarket wallet address not configured; returning 0 balance');
      return 0;
    }

    try {
      const response = await axios.get(`${DATA_API_URL}/value`, {
        params: {
          user: this.walletAddress,
        },
      });

      // The /value endpoint returns an array of { user, value }
      const balanceEntry = Array.isArray(response.data)
        ? response.data.find((entry: any) => entry.user?.toLowerCase() === this.walletAddress.toLowerCase())
        : null;

      if (!balanceEntry) {
        console.warn('Polymarket balance response did not include the requested wallet; defaulting to 0');
        return 0;
      }

      const value = parseFloat(balanceEntry.value);
      return Number.isFinite(value) ? value : 0;
    } catch (error) {
      console.error('Error fetching Polymarket balance:', error);
      return 0;
    }
  }

  async getTotalBalance(): Promise<{ totalValue: number; availableCash: number; positionsValue: number }> {
    if (!this.walletAddress) {
      console.warn('[Polymarket] ⚠️ Wallet address not configured');
      return { totalValue: 0, availableCash: 0, positionsValue: 0 };
    }

    try {
      // Get total value (includes positions)
      const totalValue = await this.getBalance();
      console.log(`[Polymarket] ✅ Total account value: $${totalValue.toFixed(2)}`);
      
      // Get positions to calculate their value
      const positions = await this.getPositions();
      console.log(`[Polymarket] 📊 Found ${positions.length} positions`);
      
      // Log first position for debugging
      if (positions.length > 0) {
        console.log(`[Polymarket] 🔍 Sample position:`, JSON.stringify(positions[0], null, 2));
      }
      
      let positionsValue = 0;
      
      for (const position of positions) {
        // Polymarket positions have current value already calculated
        if (position.value) {
          const value = parseFloat(position.value);
          positionsValue += value;
          console.log(`[Polymarket]   → Position value: $${value.toFixed(2)}`);
        } else if (position.size && position.outcome_price) {
          // Fallback: calculate from size and price
          const value = parseFloat(position.size) * parseFloat(position.outcome_price);
          positionsValue += value;
          console.log(`[Polymarket]   → Calculated: ${position.size} @ $${position.outcome_price} = $${value.toFixed(2)}`);
        } else {
          console.warn(`[Polymarket] ⚠️ Skipping position - missing data:`, position);
        }
      }
      
      console.log(`[Polymarket] 💰 Positions value: $${positionsValue.toFixed(2)}`);
      
      // Available cash = total value - positions value
      const availableCash = totalValue - positionsValue;
      console.log(`[Polymarket] 💵 Available cash: $${availableCash.toFixed(2)}`);
      
      return {
        totalValue: totalValue,
        availableCash: Math.max(0, availableCash), // Ensure non-negative
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

