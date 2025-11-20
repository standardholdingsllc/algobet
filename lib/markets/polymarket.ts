import axios from 'axios';
import { ethers, parseUnits } from 'ethers';
import { Market } from '@/types';

const BASE_URL = 'https://clob.polymarket.com';
const GAMMA_URL = 'https://gamma-api.polymarket.com';
const DATA_API_URL = 'https://data-api.polymarket.com';

// Alternative API endpoints to try
const MAIN_API_URL = 'https://api.polymarket.com';
const SPORTS_API_URL = 'https://sports-api.polymarket.com';

// EIP712 Domain for Polymarket CLOB
const EIP712_DOMAIN = {
  name: 'Polymarket CLOB',
  version: '1',
  chainId: 137, // Polygon
  verifyingContract: '0x4BFB41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', // CLOB Exchange contract
};

// EIP712 Types for Limit Orders
const EIP712_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' },
  ],
};

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
      console.log('[Polymarket CLOB] Fetching markets from CLOB API...');

      // Use CLOB API markets endpoint
      // The CLOB API provides active markets through /markets endpoint
      const response = await axios.get(`${BASE_URL}/markets`, {
        params: {
          active: true,
          limit: 200, // Reasonable limit for CLOB API
        },
      });

      console.log(`[Polymarket CLOB] API Response: ${response.data?.length || 0} markets received`);

      if (!response.data || !Array.isArray(response.data)) {
        console.warn('[Polymarket CLOB] Unexpected response format:', typeof response.data);
        return [];
      }

      const markets: Market[] = [];
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + maxDaysToExpiry);

      let processedCount = 0;
      let skippedNonBinary = 0;
      let skippedExpired = 0;
      let skippedMissingTokens = 0;
      let sportsMarketsFound = 0;
      let predictionMarketsFound = 0;

      for (const market of response.data) {
        processedCount++;

        // Debug first few markets to understand the CLOB API structure
        if (processedCount <= 3) {
          console.log(`[Polymarket CLOB] Market ${processedCount}:`, {
            id: market.market_id || market.id,
            question: market.question?.substring(0, 50),
            end_date: market.end_date,
            active: market.active,
            closed: market.closed,
            outcomes: market.outcomes,
            prices: market.prices,
            available_fields: Object.keys(market),
          });
        }

        // Check if market has expired or is too far in the future
        if (!market.end_date) {
          skippedExpired++;
          continue;
        }

        const expiryDate = new Date(market.end_date + 'T23:59:59Z');
        const now = new Date();

        if (expiryDate < now || expiryDate > maxDate) {
          skippedExpired++;
          continue;
        }

        // Check if market is active
        if (market.closed || market.active === false) {
          skippedExpired++;
          continue;
        }

        // Parse outcomes and prices from CLOB API format
        let outcomes: string[];
        let prices: number[];

        try {
          // CLOB API might have different field names
          outcomes = market.outcomes || market.tokens?.map((t: any) => t.outcome) || [];
          prices = market.prices || market.outcome_prices || [];

          // If outcomes come as objects, extract the outcome names
          if (outcomes.length > 0 && typeof outcomes[0] === 'object') {
            outcomes = outcomes.map((o: any) => o.outcome || o.name);
          }
        } catch (error) {
          console.warn(`[Polymarket CLOB] Failed to parse outcomes/prices for market ${market.market_id || market.id}:`, error);
          skippedNonBinary++;
          continue;
        }

        if (!outcomes || outcomes.length !== 2 || !prices || prices.length !== 2) {
          skippedNonBinary++;
          continue;
        }

        // Convert prices from decimal (0-1) to cents (0-100)
        const yesPrice = Math.round(prices[0] * 100);
        const noPrice = Math.round(prices[1] * 100);

        // Categorize markets by type
        const question = market.question?.toLowerCase() || '';
        const isSportsRelated = (
          question.includes('football') ||
          question.includes('soccer') ||
          question.includes('basketball') ||
          question.includes('baseball') ||
          question.includes('hockey') ||
          question.includes('tennis') ||
          question.includes('golf') ||
          question.includes('nfl') ||
          question.includes('nba') ||
          question.includes('mlb') ||
          question.includes('nhl') ||
          (question.includes('match') && !question.includes('political')) ||
          (question.includes('game') && !question.includes('political')) ||
          (question.includes('vs ') && !question.includes('political')) ||
          (question.includes(' vs') && !question.includes('political')) ||
          question.includes('score') ||
          question.includes('final score') ||
          question.includes('point spread') ||
          question.includes('over/under')
        );

        if (isSportsRelated) {
          sportsMarketsFound++;
        } else {
          predictionMarketsFound++;
        }

        // Create market with CLOB API structure
        const marketData = {
          id: market.market_id || market.condition_id || market.id,
          platform: 'polymarket' as const,
          ticker: market.market_id || market.condition_id || market.id,
          marketType: 'prediction' as const,
          title: market.question,
          yesPrice,
          noPrice,
          expiryDate: expiryDate.toISOString(),
          volume: parseFloat(market.volume || market.volume24hr || '0'),
        };

        // Log successfully added markets for debugging
        if (markets.length <= 5) {
          console.log(`[Polymarket CLOB] ✅ Added market ${markets.length + 1}:`, {
            id: marketData.id?.substring(0, 10),
            question: marketData.title?.substring(0, 50),
            expiry: marketData.expiryDate,
            days_from_now: (expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
            yes_price: marketData.yesPrice,
            no_price: marketData.noPrice
          });
        }

        markets.push(marketData);
      }

      console.log(`[Polymarket CLOB] Processing results:`);
      console.log(`  - Total markets processed: ${processedCount}`);
      console.log(`  - Sports-related markets: ${sportsMarketsFound}`);
      console.log(`  - Prediction/other markets: ${predictionMarketsFound}`);
      console.log(`  - Added: ${markets.length}`);
      console.log(`  - Skipped (expired/future): ${skippedExpired}`);
      console.log(`  - Skipped (non-binary): ${skippedNonBinary}`);
      console.log(`  - Skipped (missing data): ${skippedMissingTokens}`);

      if (markets.length > 0) {
        const earliestExpiry = markets.reduce((min, m) => m.expiryDate < min ? m.expiryDate : min, markets[0].expiryDate);
        const latestExpiry = markets.reduce((max, m) => m.expiryDate > max ? m.expiryDate : max, markets[0].expiryDate);
        console.log(`[Polymarket CLOB] Added markets expiry range: ${earliestExpiry} to ${latestExpiry}`);
      }

      return markets;
    } catch (error: any) {
      console.error('[Polymarket CLOB] Error fetching markets:', error.message);
      if (error.response) {
        console.error(`[Polymarket CLOB] Response status: ${error.response.status}`);
        console.error(`[Polymarket CLOB] Response data:`, error.response.data);
      }
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
    // IMPORTANT: /value endpoint returns POSITIONS VALUE ONLY, not total account value
    // This method is kept for backward compatibility but should not be used alone
    // Use getTotalBalance() to get the full breakdown
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

      // The /value endpoint returns POSITIONS VALUE ONLY
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

  async getWalletBalance(): Promise<number> {
    // Query the Polygon blockchain to get actual USDC balance
    // This requires querying the USDC contract on Polygon
    if (!this.walletAddress) {
      return 0;
    }

    try {
      // Use Polygon RPC to check USDC balance
      // USDC contract on Polygon: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
      const POLYGON_RPC = 'https://polygon-rpc.com';
      const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
      
      // ERC20 balanceOf function signature
      const data = `0x70a08231000000000000000000000000${this.walletAddress.slice(2)}`;
      
      const response = await axios.post(POLYGON_RPC, {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            to: USDC_CONTRACT,
            data: data,
          },
          'latest',
        ],
      });

      if (response.data.result) {
        // USDC has 6 decimals
        const balance = parseInt(response.data.result, 16) / 1e6;
        console.log(`[Polymarket] 💵 Wallet USDC balance: $${balance.toFixed(2)}`);
        return balance;
      }

      return 0;
    } catch (error: any) {
      console.warn('[Polymarket] Failed to fetch wallet USDC balance:', error.message);
      return -1; // Sentinel value indicating failure
    }
  }

  async getAvailableBalance(): Promise<number> {
    // Get available cash balance from CLOB API
    if (!this.walletAddress) {
      return 0;
    }

    try {
      // CLOB API balance endpoint - get collateral balance
      const response = await axios.get(`${BASE_URL}/balance`, {
        params: {
          address: this.walletAddress,
        },
      });

      console.log('[Polymarket CLOB] Balance response:', response.data);

      // Parse the collateral balance (available USDC)
      const balance = parseFloat(response.data.collateral || response.data.balance || '0');
      return Number.isFinite(balance) ? balance : 0;
    } catch (error: any) {
      console.warn('[Polymarket CLOB] Balance endpoint failed:', error.response?.status || error.message);
      return -1; // Use -1 as a sentinel value for failure
    }
  }

  async getTotalBalance(): Promise<{ totalValue: number; availableCash: number; positionsValue: number }> {
    if (!this.walletAddress) {
      console.warn('[Polymarket CLOB] ⚠️ Wallet address not configured');
      return { totalValue: 0, availableCash: 0, positionsValue: 0 };
    }

    try {
      // Primary approach: Use CLOB API for comprehensive balance data
      console.log('[Polymarket CLOB] Fetching balance from CLOB API...');

      // Get available collateral (cash) balance
      const availableCash = await this.getAvailableBalance();

      if (availableCash >= 0) {
        console.log(`[Polymarket CLOB] 💵 Available cash: $${availableCash.toFixed(2)}`);

        // Get positions value from Data API as fallback (CLOB might not have this)
        const positionsValue = await this.getBalance();
        console.log(`[Polymarket CLOB] 📊 Positions value: $${positionsValue.toFixed(2)}`);

        const totalValue = availableCash + positionsValue;
        console.log(`[Polymarket CLOB] ✅ Total account value: $${totalValue.toFixed(2)}`);

        return {
          totalValue,
          availableCash,
          positionsValue
        };
      }

      // Fallback: Use blockchain query for wallet balance
      console.log('[Polymarket CLOB] ⚠️ CLOB API failed, trying blockchain query...');
      const walletBalance = await this.getWalletBalance();

      if (walletBalance >= 0) {
        console.log(`[Polymarket CLOB] 💵 Wallet USDC balance: $${walletBalance.toFixed(2)}`);

        const positionsValue = await this.getBalance();
        console.log(`[Polymarket CLOB] 📊 Positions value: $${positionsValue.toFixed(2)}`);

        const totalValue = walletBalance + positionsValue;
        console.log(`[Polymarket CLOB] ✅ Total account value: $${totalValue.toFixed(2)}`);

        return {
          totalValue,
          availableCash: walletBalance,
          positionsValue
        };
      }

      // Last resort: Use positions data only
      console.log('[Polymarket CLOB] ⚠️ All balance queries failed, using positions only...');
      const positionsValue = await this.getBalance();

      console.log(`[Polymarket CLOB] 💰 Positions value: $${positionsValue.toFixed(2)}`);
      console.log(`[Polymarket CLOB] ⚠️ Cannot determine cash balance`);

      return {
        totalValue: positionsValue,
        availableCash: 0,
        positionsValue
      };

    } catch (error: any) {
      console.error('[Polymarket CLOB] ❌ Error fetching total balance:', error.message);
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
      if (!this.privateKey || !this.walletAddress) {
        return { success: false, error: 'Private key and wallet address required for CLOB orders' };
      }

      // Convert price to decimal (0-1)
      const priceDecimal = price / 100;

      // Create wallet from private key
      const wallet = new ethers.Wallet(this.privateKey);

      // For limit orders, we need to calculate maker and taker amounts
      // makerAmount = size in outcome tokens
      // takerAmount = size * price in collateral (USDC)
      const makerAmount = parseUnits(size.toString(), 6); // USDC has 6 decimals
      const takerAmount = parseUnits((size * priceDecimal).toFixed(6), 6);

      // Create order data for EIP712 signing
      const orderData = {
        salt: BigInt(Date.now()), // Use timestamp as salt
        maker: this.walletAddress,
        signer: this.walletAddress,
        taker: ethers.ZeroAddress, // Allow any taker
        tokenId: BigInt(tokenId),
        makerAmount,
        takerAmount,
        expiration: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour expiry
        nonce: BigInt(0), // Can be incremented for multiple orders
        feeRateBps: BigInt(0), // 0 bps fee for current CLOB
        side: side === 'yes' ? 0 : 1, // 0 = BUY, 1 = SELL
        signatureType: 0, // EIP712
      };

      // Sign the order using EIP712
      const signature = await wallet._signTypedData(EIP712_DOMAIN, EIP712_TYPES, orderData);

      // Create the signed order payload
      const signedOrder = {
        order: orderData,
        signature,
        owner: this.walletAddress,
      };

      console.log('[Polymarket CLOB] Placing signed order:', {
        tokenId,
        side,
        price: priceDecimal,
        size,
        orderData: {
          ...orderData,
          salt: orderData.salt.toString(),
          tokenId: orderData.tokenId.toString(),
          makerAmount: orderData.makerAmount.toString(),
          takerAmount: orderData.takerAmount.toString(),
          expiration: orderData.expiration.toString(),
          nonce: orderData.nonce.toString(),
          feeRateBps: orderData.feeRateBps.toString(),
        }
      });

      // Submit the signed order to CLOB API
      const response = await axios.post(`${BASE_URL}/order`, signedOrder, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.data && response.data.order_id) {
        console.log('[Polymarket CLOB] Order placed successfully:', response.data.order_id);
        return { success: true, orderId: response.data.order_id };
      }

      console.warn('[Polymarket CLOB] Order response:', response.data);
      return { success: false, error: 'Order not filled or invalid response' };
    } catch (error: any) {
      console.error('[Polymarket CLOB] Error placing order:', error.message);
      if (error.response) {
        console.error('[Polymarket CLOB] Response status:', error.response.status);
        console.error('[Polymarket CLOB] Response data:', error.response.data);
      }
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

