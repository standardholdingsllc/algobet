import axios from 'axios';
import { Market } from '@/types';
import { POLYMARKET_DATA_API, POLYMARKET_FEE } from '@/lib/constants';

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

export class PolymarketService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.POLYMARKET_API_KEY || '';
    this.baseUrl = POLYMARKET_DATA_API;
  }

  async getOpenMarkets(): Promise<Market[]> {
    try {
      // Polymarket Gamma API endpoint for active markets
      const response = await axios.get(`${this.baseUrl}/markets`, {
        params: {
          closed: false,
          limit: 200,
        },
      });

      const markets: PolymarketMarket[] = response.data || [];
      return markets.map(this.transformMarket).filter(m => m !== null) as Market[];
    } catch (error) {
      console.error('Error fetching Polymarket markets:', error);
      return [];
    }
  }

  async getMarketsByExpiry(maxDays: number): Promise<Market[]> {
    const allMarkets = await this.getOpenMarkets();
    const now = new Date();
    const maxDate = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);

    return allMarkets.filter(market => new Date(market.expiryDate) <= maxDate);
  }

  async getMarketPrices(marketId: string): Promise<{ yes: number, no: number } | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/markets/${marketId}`);
      const market = response.data;

      if (market.outcomePrices && market.outcomePrices.length >= 2) {
        // Convert from 0-1 to 0-100 (cents)
        const yesPrice = Math.round(parseFloat(market.outcomePrices[0]) * 100);
        const noPrice = Math.round(parseFloat(market.outcomePrices[1]) * 100);

        return { yes: yesPrice, no: noPrice };
      }

      return null;
    } catch (error) {
      console.error(`Error fetching Polymarket prices for ${marketId}:`, error);
      return null;
    }
  }

  async placeOrder(
    marketId: string,
    side: 'yes' | 'no',
    amount: number,
    price: number
  ): Promise<string | null> {
    try {
      // Note: Polymarket uses their CLOB API for order placement
      // This requires proper authentication and signing
      // Implementation depends on their specific requirements
      
      const outcomeIndex = side === 'yes' ? 0 : 1;
      
      const response = await axios.post(
        `${POLYMARKET_DATA_API}/order`,
        {
          market: marketId,
          outcome: outcomeIndex,
          side: 'BUY',
          size: amount.toString(),
          price: (price / 100).toFixed(4), // Convert cents to decimal
          type: 'FOK', // Fill or Kill
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      return response.data.orderId || null;
    } catch (error) {
      console.error('Error placing Polymarket order:', error);
      return null;
    }
  }

  async getBalance(): Promise<number> {
    try {
      // This would need to query the user's wallet balance
      // Implementation depends on Polymarket's specific API
      const response = await axios.get(`${this.baseUrl}/balance`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      return parseFloat(response.data.balance || '0');
    } catch (error) {
      console.error('Error fetching Polymarket balance:', error);
      return 0;
    }
  }

  private transformMarket(polymarketMarket: PolymarketMarket): Market | null {
    try {
      // Only process binary markets (Yes/No)
      if (!polymarketMarket.tokens || polymarketMarket.tokens.length !== 2) {
        return null;
      }

      const yesPrice = Math.round(parseFloat(polymarketMarket.tokens[0]?.price || '0') * 100);
      const noPrice = Math.round(parseFloat(polymarketMarket.tokens[1]?.price || '0') * 100);

      return {
        id: polymarketMarket.condition_id,
        platform: 'polymarket',
        ticker: polymarketMarket.condition_id,
        marketType: 'prediction',
        title: polymarketMarket.question,
        expiryDate: new Date(polymarketMarket.end_date_iso).toISOString(),
        yesPrice,
        noPrice,
        volume: parseFloat(polymarketMarket.volume || '0'),
      };
    } catch (error) {
      console.error('Error transforming Polymarket market:', error);
      return null;
    }
  }

  static calculateFees(amount: number): number {
    // Polymarket charges 2% on trade amount
    return amount * (POLYMARKET_FEE / 100);
  }
}

