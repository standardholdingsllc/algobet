import axios from 'axios';
import { Market } from '@/types';

const BASE_URL = 'https://api.sx.bet';

interface SXBetMarket {
  marketHash: string;
  outcomeOneName: string;
  outcomeTwoName: string;
  teamOneName?: string;
  teamTwoName?: string;
  status: number;
  sportXeventId: string;
  line?: number;
  mainLine: boolean;
  type: number;
  leagueLabel: string;
  gameLabel: string;
  reporterKey: string;
  group?: number;
  teamOneLogo?: string;
  teamTwoLogo?: string;
}

interface SXBetOrder {
  orderHash: string;
  marketHash: string;
  maker: string;
  totalBetSize: string; // in wei
  percentageOdds: string; // maker's implied odds (divide by 10^20)
  isMakerBettingOutcomeOne: boolean;
  baseToken: string;
  expiry: number;
  fillAmount: string;
}

interface SXBetFixture {
  sportXeventId: string;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  startDate: string;
  status: number;
  sportLabel: string;
  leagueLabel: string;
  homeTeam: string;
  awayTeam: string;
}

/**
 * SX.bet API Integration
 * Documentation: https://api.docs.sx.bet/#introduction
 * 
 * Key differences from other platforms:
 * - Sports betting focus (not prediction markets)
 * - Uses own L2 chain (SX Network)
 * - Odds format: percentage odds / 10^20
 * - USDC on SX Network (not mainnet)
 * - 0% fees (both maker and taker)
 */
export class SXBetAPI {
  private apiKey: string;
  private baseToken: string; // USDC address on SX Network
  private walletAddress: string;
  private privateKey: string;

  constructor() {
    this.apiKey = process.env.SBET_API_KEY || '';
    this.baseToken = '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B'; // USDC on SX mainnet
    this.walletAddress = process.env.SBET_WALLET_ADDRESS || '';
    this.privateKey = process.env.SBET_PRIVATE_KEY || '';
  }

  /**
   * Get authentication headers
   */
  private getHeaders(): Record<string, string> {
    if (!this.apiKey) {
      console.warn('[sx.bet] No API key configured - endpoints will fail');
    }
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey,
    };
  }

  /**
   * Convert sx.bet percentage odds to decimal odds format
   * sx.bet stores: percentageOdds / 10^20 = implied probability (maker's perspective)
   * 
   * For sportsbook odds, we need to convert implied probability to decimal odds:
   * Decimal odds = 1 / implied probability
   * 
   * Example:
   * - percentageOdds = 70455284072443640000
   * - Implied prob (maker) = 0.70455 (70.455%)
   * - Taker gets opposite: 1 - 0.70455 = 0.29545 (29.545%)
   * - Decimal odds (taker) = 1 / 0.29545 = 3.385
   */
  private convertToDecimalOdds(percentageOdds: string, isMakerOdds: boolean = true): number {
    const oddsWei = BigInt(percentageOdds);
    const divisor = BigInt('100000000000000000000'); // 10^20
    
    // Convert to decimal implied probability (0-1)
    const impliedProb = Number(oddsWei) / Number(divisor);
    
    // Taker gets the opposite probability
    const takerProb = isMakerOdds ? 1 - impliedProb : impliedProb;
    
    // Convert to decimal odds: odds = 1 / probability
    // Minimum odds of 1.01 to avoid division by zero or invalid odds
    const decimalOdds = takerProb > 0 ? 1 / takerProb : 1.01;
    
    return Math.max(1.01, decimalOdds); // Ensure odds are at least 1.01
  }

  /**
   * Get active markets within expiry window
   */
  async getOpenMarkets(maxDaysToExpiry: number): Promise<Market[]> {
    try {
      // Get active markets
      const marketsResponse = await axios.get(`${BASE_URL}/markets/active`, {
        headers: this.getHeaders(),
        params: {
          baseToken: this.baseToken,
        },
      });

      // Try to get fixtures for event details (but make it optional)
      let fixtures: SXBetFixture[] = [];
      let fixtureMap = new Map<string, SXBetFixture>();

      try {
        // Try fixtures endpoint with active status (required parameter)
        const fixturesResponse = await axios.get(`${BASE_URL}/fixtures`, {
          headers: this.getHeaders(),
          params: { status: 1 }, // Only active fixtures
        });
        fixtures = fixturesResponse.data.data || [];
        fixtureMap = new Map(fixtures.map(f => [f.sportXeventId, f]));
        console.log(`[sx.bet] Retrieved ${fixtures.length} fixtures`);
      } catch (fixtureError: any) {
        console.warn(`[sx.bet] Fixtures endpoint not available (${fixtureError.response?.status}), continuing without fixture data`);
      }

      // Try to get active orders (required for market data)
      let ordersResponse: any;
      try {
        // First try best-odds endpoint
        ordersResponse = await axios.get(`${BASE_URL}/orders/best-odds`, {
          headers: this.getHeaders(),
          params: {
            baseToken: this.baseToken,
          },
        });
        console.log(`[sx.bet] Retrieved ${ordersResponse.data?.data?.length || 0} orders from best-odds endpoint`);
      } catch (bestOddsError: any) {
        console.warn(`[sx.bet] Best-odds endpoint failed (${bestOddsError.response?.status}), trying active orders...`);

        try {
          // Fallback to active orders endpoint
          ordersResponse = await axios.get(`${BASE_URL}/orders/active`, {
            headers: this.getHeaders(),
            params: {
              baseToken: this.baseToken,
            },
          });
          console.log(`[sx.bet] Retrieved ${ordersResponse.data?.data?.length || 0} orders from active orders endpoint`);
        } catch (activeOrdersError: any) {
          console.warn(`[sx.bet] Active orders endpoint also failed (${activeOrdersError.response?.status}), cannot fetch markets without order data`);
          return [];
        }
      }

      const markets: Market[] = [];
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + maxDaysToExpiry);

      for (const market of marketsResponse.data.data || []) {
        // Get fixture details (optional)
        const fixture = fixtureMap.get(market.sportXeventId);
        
        // Determine expiry date
        let expiryDate: Date;
        if (fixture && fixture.startDate) {
          expiryDate = new Date(fixture.startDate);
        } else {
          // If no fixture data, skip markets without expiry info
          // Or use a far future date if we want to include them
          console.warn(`[sx.bet] Skipping market ${market.marketHash} - no fixture data`);
          continue;
        }
        
        // Only include markets within expiry window and not started
        if (expiryDate > maxDate || expiryDate < new Date()) continue;

        // Get best odds for this market
        const marketOrders = (ordersResponse.data.data || []).filter(
          (order: SXBetOrder) => order.marketHash === market.marketHash
        );

        if (marketOrders.length === 0) continue;

        // Separate by outcome
        const outcomeOneOrders = marketOrders.filter((o: SXBetOrder) => o.isMakerBettingOutcomeOne);
        const outcomeTwoOrders = marketOrders.filter((o: SXBetOrder) => !o.isMakerBettingOutcomeOne);

        // Get best odds (lowest maker odds = highest taker odds)
        const bestOutcomeOne = outcomeOneOrders.sort((a: SXBetOrder, b: SXBetOrder) => 
          Number(a.percentageOdds) - Number(b.percentageOdds)
        )[0];

        const bestOutcomeTwo = outcomeTwoOrders.sort((a: SXBetOrder, b: SXBetOrder) =>
          Number(a.percentageOdds) - Number(b.percentageOdds)
        )[0];

        if (!bestOutcomeOne || !bestOutcomeTwo) continue;

        // Convert to decimal odds (taker perspective)
        const outcomeOneOdds = this.convertToDecimalOdds(bestOutcomeOne.percentageOdds, true);
        const outcomeTwoOdds = this.convertToDecimalOdds(bestOutcomeTwo.percentageOdds, true);

        // Create market title
        const title = fixture ? this.createMarketTitle(market, fixture) : this.createFallbackTitle(market);

        markets.push({
          id: market.marketHash,
          platform: 'sxbet',
          ticker: market.marketHash.substring(0, 16),
          marketType: 'sportsbook',
          title,
          yesPrice: outcomeOneOdds,
          noPrice: outcomeTwoOdds,
          expiryDate: expiryDate.toISOString(),
          volume: 0,
        });
      }

      return markets;
    } catch (error) {
      console.error('Error fetching sx.bet markets:', error);
      return [];
    }
  }

  /**
   * Create fallback title when fixture data is not available
   */
  private createFallbackTitle(market: SXBetMarket): string {
    return `${market.leagueLabel || 'Sports'} - ${market.gameLabel || market.outcomeOneName + ' vs ' + market.outcomeTwoName}`;
  }

  /**
   * Create readable market title from market and fixture data
   */
  private createMarketTitle(market: SXBetMarket, fixture: SXBetFixture): string {
    const sport = fixture.sportLabel;
    const league = fixture.leagueLabel;
    const homeTeam = fixture.homeTeam;
    const awayTeam = fixture.awayTeam;

    // Handle different market types
    if (market.type === 1) {
      // Moneyline (winner)
      return `${sport} - ${league}: ${homeTeam} vs ${awayTeam} - Winner`;
    } else if (market.type === 2) {
      // Spread
      const line = market.line ? ` ${market.line > 0 ? '+' : ''}${market.line}` : '';
      return `${sport} - ${league}: ${homeTeam} vs ${awayTeam} - Spread${line}`;
    } else if (market.type === 3) {
      // Total (over/under)
      const line = market.line ? ` ${market.line}` : '';
      return `${sport} - ${league}: ${homeTeam} vs ${awayTeam} - Total${line}`;
    } else {
      // Generic
      return `${sport} - ${league}: ${homeTeam} vs ${awayTeam} - ${market.outcomeOneName} vs ${market.outcomeTwoName}`;
    }
  }

  /**
   * Get account balance (USDC on SX Network)
   * Note: Requires querying blockchain directly or using sx.bet wallet API
   */
  async getBalance(): Promise<number> {
    try {
      if (!this.walletAddress) {
        console.warn('sx.bet balance check requires SBET_WALLET_ADDRESS env var');
        return 0;
      }

      // sx.bet doesn't provide a direct balance endpoint in their API
      // You would need to query the SX Network blockchain directly

      // TODO: Implement Web3 query to SX Network for USDC balance
      // const provider = new ethers.providers.JsonRpcProvider('https://rpc.sx-rollup.gelato.digital');
      // const usdcContract = new ethers.Contract(this.baseToken, erc20ABI, provider);
      // const balance = await usdcContract.balanceOf(this.walletAddress);
      // return Number(balance) / 1e6; // USDC has 6 decimals

      console.warn('sx.bet balance check requires Web3 integration - wallet configured but Web3 not implemented');
      return 0;
    } catch (error) {
      console.error('Error fetching sx.bet balance:', error);
      return 0;
    }
  }

  /**
   * Place a bet on sx.bet
   * Note: This is simplified - full implementation requires EIP712 signing
   */
  async placeBet(
    marketHash: string,
    side: 'yes' | 'no', // yes = outcome one, no = outcome two
    price: number, // in cents (0-100)
    quantity: number // number of contracts
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      // sx.bet uses a more complex order flow:
      // 1. Get best orders for the market
      // 2. Sign an EIP712 message
      // 3. Submit fill request
      
      // This is a placeholder - full implementation requires:
      // - EIP712 signing with private key
      // - Order matching logic
      // - Fill submission
      
      console.warn('sx.bet betting not fully implemented - requires EIP712 signing');
      
      return {
        success: false,
        error: 'sx.bet integration requires EIP712 signing implementation'
      };
      
      // TODO: Implement full betting flow:
      // 1. const orders = await this.getOrdersForMarket(marketHash, side);
      // 2. const signature = await this.signEIP712(order, walletAddress);
      // 3. const result = await this.submitFill(orders, signature, quantity);
      // 4. return result;
      
    } catch (error: any) {
      console.error('Error placing sx.bet bet:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get orders for a specific market
   */
  async getOrdersForMarket(marketHash: string, side: 'yes' | 'no'): Promise<SXBetOrder[]> {
    try {
      let response;
      try {
        // Try best-odds first
        response = await axios.get(`${BASE_URL}/orders/best-odds`, {
          headers: this.getHeaders(),
          params: {
            baseToken: this.baseToken,
            marketHashes: marketHash,
          },
        });
      } catch (bestOddsError) {
        // Fallback to active orders
        response = await axios.get(`${BASE_URL}/orders/active`, {
          headers: this.getHeaders(),
          params: {
            baseToken: this.baseToken,
            marketHash: marketHash,
          },
        });
      }

      const allOrders: SXBetOrder[] = response.data.data || [];

      // Filter by side
      const isBettingOutcomeOne = side === 'yes';
      return allOrders.filter(order =>
        order.marketHash === marketHash &&
        order.isMakerBettingOutcomeOne !== isBettingOutcomeOne // Taker bets opposite of maker
      );
    } catch (error) {
      console.error('Error fetching sx.bet orders:', error);
      return [];
    }
  }

  /**
   * Get active trades/positions
   */
  async getPositions(): Promise<any[]> {
    try {
      if (!this.walletAddress) {
        console.warn('sx.bet positions check not implemented - requires SBET_WALLET_ADDRESS env var');
        return [];
      }

      const response = await axios.get(`${BASE_URL}/trades/active/${this.walletAddress}`, {
        headers: this.getHeaders(),
      });
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching sx.bet positions:', error);
      return [];
    }
  }

  /**
   * Get available sports
   */
  async getSports(): Promise<any[]> {
    try {
      const response = await axios.get(`${BASE_URL}/sports`, {
        headers: this.getHeaders(),
      });
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching sx.bet sports:', error);
      return [];
    }
  }

  /**
   * Get leagues for a sport
   */
  async getLeagues(sportId?: number): Promise<any[]> {
    try {
      const response = await axios.get(`${BASE_URL}/leagues/active`, {
        headers: this.getHeaders(),
        params: sportId ? { sportId } : {},
      });
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching sx.bet leagues:', error);
      return [];
    }
  }
}

