import { Market } from '@/types';
import { PolymarketAPI } from '@/lib/markets/polymarket';
import { POLYMARKET_FEE } from '@/lib/constants';


export class PolymarketService {
  private polymarketAPI: PolymarketAPI;

  constructor() {
    this.polymarketAPI = new PolymarketAPI();
  }

  async getOpenMarkets(): Promise<Market[]> {
    // Use the CLOB API implementation
    return this.polymarketAPI.getOpenMarkets(30); // Default to 30 days
  }

  async getMarketsByExpiry(maxDays: number): Promise<Market[]> {
    return this.polymarketAPI.getOpenMarkets(maxDays);
  }

  async getMarketPrices(marketId: string): Promise<{ yes: number, no: number } | null> {
    // For now, return null as CLOB API focuses on order book data
    // This method may need to be updated based on specific CLOB endpoints
    console.log(`[PolymarketService] getMarketPrices not implemented for CLOB API`);
    return null;
  }

  async placeOrder(
    marketId: string,
    side: 'yes' | 'no',
    amount: number,
    price: number
  ): Promise<string | null> {
    try {
      // Use the CLOB API implementation with EIP712 signing
      const result = await this.polymarketAPI.placeBet(marketId, side, price, amount);

      if (result.success && result.orderId) {
        return result.orderId;
      }

      console.error('Polymarket order failed:', result.error);
      return null;
    } catch (error) {
      console.error('Error placing Polymarket order:', error);
      return null;
    }
  }

  async getBalance(): Promise<number> {
    // Delegate to the CLOB API implementation
    return this.polymarketAPI.getBalance();
  }

  async getPositions(): Promise<any[]> {
    // Delegate to the CLOB API implementation
    return this.polymarketAPI.getPositions();
  }

  async getTotalBalance(): Promise<{ totalValue: number; availableCash: number; positionsValue: number }> {
    // Delegate to the CLOB API implementation
    return this.polymarketAPI.getTotalBalance();
  }


  static calculateFees(amount: number): number {
    // Polymarket charges 2% on trade amount
    return amount * (POLYMARKET_FEE / 100);
  }
}

