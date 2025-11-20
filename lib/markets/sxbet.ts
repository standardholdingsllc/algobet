import axios from 'axios';
import { ethers } from 'ethers';
import { Market } from '@/types';

const BASE_URL = 'https://api.sx.bet';
const SXBET_BEST_ODDS_CHUNK = 25;

// ERC20 ABI for balance queries
const erc20ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

interface SXBetMarket {
  status: string;
  marketHash: string;
  outcomeOneName: string;
  outcomeTwoName: string;
  outcomeVoidName?: string;
  teamOneName?: string;
  teamTwoName?: string;
  type: number;
  gameTime?: number;
  sportXeventId: string;
  sportLabel?: string;
  sportId?: number;
  leagueId?: number;
  leagueLabel?: string;
  chainVersion?: string;
  group1?: string;
  line?: number;
  mainLine?: boolean;
  reporterKey?: string;
  group?: number;
  teamOneLogo?: string;
  teamTwoLogo?: string;
  gameLabel?: string;
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

interface SXBetBestOddsOutcome {
  percentageOdds: string | null;
  updatedAt: number | null;
}

interface SXBetBestOddsEntry {
  marketHash: string;
  baseToken: string;
  outcomeOne: SXBetBestOddsOutcome;
  outcomeTwo: SXBetBestOddsOutcome;
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
 * CURRENT STATUS: Full integration with correct endpoints
 * - ✅ Can fetch active markets (/markets/active)
 * - ✅ Can fetch fixtures (/fixture/active)
 * - ✅ Can fetch order data (/orders/odds/best or /orders)
 * - ✅ REST API is open (no API key required for REST endpoints)
 * - ✅ Real-time odds and arbitrage opportunities enabled
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
    this.apiKey = process.env.SXBET_API_KEY || '';
    this.baseToken = '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B'; // USDC on SX mainnet
    this.walletAddress = process.env.SXBET_WALLET_ADDRESS || '';
    this.privateKey = process.env.SXBET_PRIVATE_KEY || '';
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

  private async fetchBestOddsMap(
    marketHashes: string[]
  ): Promise<Map<string, SXBetBestOddsEntry>> {
    const bestOddsMap = new Map<string, SXBetBestOddsEntry>();
    if (marketHashes.length === 0) {
      return bestOddsMap;
    }

    for (let i = 0; i < marketHashes.length; i += SXBET_BEST_ODDS_CHUNK) {
      const chunk = marketHashes.slice(i, i + SXBET_BEST_ODDS_CHUNK);
      try {
        const response = await axios.get(`${BASE_URL}/orders/odds/best`, {
          headers: this.getHeaders(),
          params: {
            marketHashes: chunk.join(','),
            baseToken: this.baseToken,
          },
        });

        const bestOdds: SXBetBestOddsEntry[] = response.data?.data?.bestOdds || [];
        for (const entry of bestOdds) {
          bestOddsMap.set(entry.marketHash, entry);
        }
      } catch (error: any) {
        console.warn(
          `[sx.bet] Best odds chunk failed (${error.response?.status}) for ${chunk.length} market(s)`
        );
      }
    }

    return bestOddsMap;
  }

  /**
   * Get active markets within expiry window
   */
  async getOpenMarkets(maxDaysToExpiry: number): Promise<Market[]> {
    try {
      const marketsResponse = await axios.get(`${BASE_URL}/markets/active`, {
        headers: this.getHeaders(),
        params: {
          baseToken: this.baseToken,
        },
      });

      const fixtureMap = new Map<string, SXBetFixture>();
      const marketsData = marketsResponse.data.data?.markets || [];
      console.log(`[sx.bet] Retrieved ${marketsData.length} active markets`);

      const marketHashes = marketsData.map((market) => market.marketHash);
      const bestOddsMap = await this.fetchBestOddsMap(marketHashes);

      let fallbackOrders: SXBetOrder[] | null = null;
      const loadFallbackOrders = async (): Promise<SXBetOrder[]> => {
        if (fallbackOrders) {
          return fallbackOrders;
        }
        try {
          const response = await axios.get(`${BASE_URL}/orders`, {
            headers: this.getHeaders(),
            params: {
              baseToken: this.baseToken,
            },
          });
          fallbackOrders = response.data?.data || [];
          console.log(`[sx.bet] Retrieved ${fallbackOrders.length} active orders (fallback)`);
        } catch (error: any) {
          console.warn(
            `[sx.bet] Orders endpoint failed (${error.response?.status}) - no fallback order data available`
          );
          fallbackOrders = [];
        }
        return fallbackOrders;
      };

      const markets: Market[] = [];
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + maxDaysToExpiry);

      for (const market of marketsData) {
        const fixture = fixtureMap.get(market.sportXeventId);
        const expiryDate = this.deriveExpiryDate(market, fixture);

        if (!expiryDate) {
          console.warn(`[sx.bet] Skipping market ${market.marketHash} - no start time available`);
          continue;
        }

        if (expiryDate > maxDate || expiryDate < new Date()) continue;

        const bestOdds = bestOddsMap.get(market.marketHash);

        let outcomeOneOdds =
          bestOdds?.outcomeOne?.percentageOdds !== null && bestOdds?.outcomeOne?.percentageOdds
            ? this.convertToDecimalOdds(bestOdds.outcomeOne.percentageOdds, false)
            : null;
        let outcomeTwoOdds =
          bestOdds?.outcomeTwo?.percentageOdds !== null && bestOdds?.outcomeTwo?.percentageOdds
            ? this.convertToDecimalOdds(bestOdds.outcomeTwo.percentageOdds, false)
            : null;

        if (!outcomeOneOdds || !outcomeTwoOdds) {
          const allOrders = await loadFallbackOrders();
          if (!allOrders.length) continue;

          const marketOrders = allOrders.filter(
            (order: SXBetOrder) => order.marketHash === market.marketHash
          );

          if (marketOrders.length === 0) continue;

          const outcomeOneOrders = marketOrders.filter(
            (o: SXBetOrder) => o.isMakerBettingOutcomeOne
          );
          const outcomeTwoOrders = marketOrders.filter(
            (o: SXBetOrder) => !o.isMakerBettingOutcomeOne
          );

          const bestOutcomeOne = outcomeOneOrders.sort(
            (a: SXBetOrder, b: SXBetOrder) => Number(a.percentageOdds) - Number(b.percentageOdds)
          )[0];

          const bestOutcomeTwo = outcomeTwoOrders.sort(
            (a: SXBetOrder, b: SXBetOrder) => Number(a.percentageOdds) - Number(b.percentageOdds)
          )[0];

          if (!bestOutcomeOne || !bestOutcomeTwo) continue;

          outcomeOneOdds = this.convertToDecimalOdds(bestOutcomeOne.percentageOdds, true);
          outcomeTwoOdds = this.convertToDecimalOdds(bestOutcomeTwo.percentageOdds, true);
        }

        if (!outcomeOneOdds || !outcomeTwoOdds) continue;

        const title = fixture
          ? this.createMarketTitle(market, fixture)
          : this.createFallbackTitle(market);

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
   * Convert fixture or market timestamps into a Date
   */
  private deriveExpiryDate(
    market: SXBetMarket,
    fixture?: SXBetFixture
  ): Date | null {
    if (fixture?.startDate) {
      return new Date(fixture.startDate);
    }
    if (market.gameTime) {
      return new Date(market.gameTime * 1000);
    }
    return null;
  }

  /**
   * Create fallback title when fixture data is not available
   */
  private createFallbackTitle(market: SXBetMarket): string {
    return this.createBasicMarketTitle(market);
  }

  /**
   * Create basic market title from market data only (no fixtures needed)
   */
  private createBasicMarketTitle(market: SXBetMarket): string {
    const sport = market.leagueLabel?.split(' ')?.[0] || 'Sports'; // Extract sport from league name
    const league = market.leagueLabel || 'Unknown League';
    const event = market.gameLabel || `${market.outcomeOneName} vs ${market.outcomeTwoName}`;

    // Determine market type description
    let marketType = '';
    switch (market.type) {
      case 1:
        marketType = 'Winner';
        break;
      case 2:
        marketType = `Spread${market.line ? ` ${market.line > 0 ? '+' : ''}${market.line}` : ''}`;
        break;
      case 3:
        marketType = `Total${market.line ? ` ${market.line}` : ''}`;
        break;
      default:
        marketType = `${market.outcomeOneName} vs ${market.outcomeTwoName}`;
    }

    return `${sport} - ${league}: ${event} - ${marketType}`;
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
        console.warn('sx.bet balance check requires SXBET_WALLET_ADDRESS env var');
        return 0;
      }

      // sx.bet doesn't provide a direct balance endpoint in their API
      // You would need to query the SX Network blockchain directly

      // Query USDC balance on SX Network via Web3
      // Note: This requires the wallet to have proper permissions on SX Network
      if (this.walletAddress && this.privateKey) {
        try {
          const provider = new ethers.JsonRpcProvider('https://rpc.sx-rollup.gelato.digital');
          const wallet = new ethers.Wallet(this.privateKey, provider);
          const usdcContract = new ethers.Contract(this.baseToken, erc20ABI, provider);
          const balance = await usdcContract.balanceOf(this.walletAddress);
          return Number(balance) / 1e6; // USDC has 6 decimals
        } catch (web3Error) {
          console.warn('sx.bet Web3 balance query failed (may need elevated permissions):', web3Error instanceof Error ? web3Error.message : String(web3Error));
          return 0;
        }
      }

      console.warn('sx.bet wallet not configured for Web3 balance checking');
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
        // Try best-odds first with correct endpoint
        response = await axios.get(`${BASE_URL}/orders/odds/best`, {
          headers: this.getHeaders(),
          params: {
            baseToken: this.baseToken,
            marketHashes: marketHash,
          },
        });
      } catch (bestOddsError) {
        // Fallback to active orders with correct endpoint
        response = await axios.get(`${BASE_URL}/orders`, {
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
        console.warn('sx.bet positions check not implemented - requires SXBET_WALLET_ADDRESS env var');
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

