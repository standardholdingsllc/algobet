import axios from 'axios';
import { Market } from '@/types';

const BASE_URL = 'https://clob.polymarket.com';
const GAMMA_URL = 'https://gamma-api.polymarket.com';
const DATA_API_URL = 'https://data-api.polymarket.com';

// Try sports-specific endpoint if available
const SPORTS_URL = 'https://sports-api.polymarket.com';

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
      console.log('[Polymarket] Fetching markets from Gamma API...');
      // Try different approaches to get current live markets (not historical)
      let response;

      try {
        // Attempt 1: Filter by recently created markets (last 90 days)
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const createdSince = ninetyDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD format

        response = await axios.get(`${GAMMA_URL}/markets`, {
          params: {
            limit: 500,
            // Try filtering by creation date to get recent markets
            created_after: createdSince, // Might not be supported, but let's try
          },
        });
        console.log(`[Polymarket] Attempt 1 - Recent markets (${createdSince}): ${response.data?.length || 0} markets`);
      } catch (error) {
        console.warn('[Polymarket] Attempt 1 failed, trying different approach:', error instanceof Error ? error.message : String(error));

        try {
          // Attempt 2: Try with active=true and no closed filter
          response = await axios.get(`${GAMMA_URL}/markets`, {
            params: {
              active: true,
              limit: 500,
              // Don't include closed=false to avoid filtering out open markets
            },
          });
          console.log(`[Polymarket] Attempt 2 - Active only: ${response.data?.length || 0} markets`);
        } catch (error2) {
          console.warn('[Polymarket] Attempt 2 failed, trying basic call:', error2 instanceof Error ? error2.message : String(error2));

          // Attempt 3: Basic call with just limit
          response = await axios.get(`${GAMMA_URL}/markets`, {
            params: {
              limit: 500,
            },
          });
          console.log(`[Polymarket] Attempt 3 - Basic call: ${response.data?.length || 0} markets`);
        }
      }

      console.log(`[Polymarket] API Response: ${response.data?.length || 0} markets received`);
      
      if (!response.data || !Array.isArray(response.data)) {
        console.warn('[Polymarket] Unexpected response format:', typeof response.data);
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
      let recentMarketsFound = 0;
      let oldMarketsFound = 0;

      for (const market of response.data) {
        processedCount++;

        // Categorize markets by type
        const isSportsRelated = market.question?.toLowerCase().includes('match') ||
                               market.question?.toLowerCase().includes('game') ||
                               market.question?.toLowerCase().includes('win') ||
                               market.question?.toLowerCase().includes('vs') ||
                               market.question?.toLowerCase().includes('draw') ||
                               market.question?.toLowerCase().includes('score') ||
                               market.question?.toLowerCase().includes('football') ||
                               market.question?.toLowerCase().includes('soccer') ||
                               market.question?.toLowerCase().includes('basketball') ||
                               market.question?.toLowerCase().includes('baseball') ||
                               market.question?.toLowerCase().includes('hockey');

        if (isSportsRelated) {
          sportsMarketsFound++;
        } else {
          predictionMarketsFound++;
        }

        // Debug first few markets to understand expiry dates
        if (processedCount <= 3) {
          const expiryDate = market.endDateIso ? new Date(market.endDateIso + 'T23:59:59Z') : null;
          const now = new Date();
          const daysFromNow = expiryDate ? (expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000) : null;

          console.log(`[Polymarket] Market ${processedCount}:`, {
            conditionId: market.conditionId,
            question: market.question?.substring(0, 50),
            endDateIso: market.endDateIso,
            expiry_parsed: expiryDate?.toISOString(),
            days_from_now: daysFromNow?.toFixed(1),
            is_expired: expiryDate && expiryDate < now,
            is_too_far: expiryDate && expiryDate > maxDate,
            active: market.active,
            closed: market.closed,
            outcomes: market.outcomes,
            outcomePrices: market.outcomePrices,
            available_fields: Object.keys(market),
          });
        }
        
        if (!market.endDateIso) {
          skippedExpired++;
          continue;
        }

        const expiryDate = new Date(market.endDateIso + 'T23:59:59Z');
        const now = new Date();

        // Check if market is recently created (within last 90 days)
        const createdAt = market.createdAt ? new Date(market.createdAt) : null;
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const isRecent = createdAt && createdAt > ninetyDaysAgo;

        // Count recent vs old markets
        if (isRecent) {
          recentMarketsFound++;
        } else {
          oldMarketsFound++;
        }

        // Skip if market has expired OR is too far in the future OR is old (created >90 days ago)
        if (expiryDate < now || expiryDate > maxDate || !isRecent) {
          // Log details about skipped markets for better debugging
          // Focus on markets that might be sports-related or near-term
          const isSportsRelated = market.question?.toLowerCase().includes('match') ||
                                 market.question?.toLowerCase().includes('game') ||
                                 market.question?.toLowerCase().includes('win') ||
                                 market.question?.toLowerCase().includes('vs') ||
                                 market.question?.toLowerCase().includes('draw');

          if (processedCount <= 15 && (isSportsRelated || processedCount <= 5)) { // Log sports markets and first 5
            console.log(`[Polymarket] Skipping market ${processedCount} (${isSportsRelated ? 'SPORTS' : 'OTHER'}):`, {
              question: market.question?.substring(0, 60),
              expiry: expiryDate?.toISOString(),
              created: createdAt?.toISOString(),
              days_from_now: expiryDate ? (expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000) : 'N/A',
              is_expired: expiryDate < now,
              is_too_far: expiryDate > maxDate,
              is_old: !isRecent,
              reason: expiryDate < now ? 'EXPIRED' : (expiryDate > maxDate ? 'TOO_FAR' : (!isRecent ? 'TOO_OLD' : 'UNKNOWN'))
            });
          }
          skippedExpired++;
          continue;
        }

        // Additional check: skip if market has an 'active' field and it's false
        if (market.active === false || market.active === 'false') {
          skippedExpired++;
          continue;
        }
        
        // Parse outcomes and outcomePrices (they come as JSON strings)
        let outcomes: string[];
        let prices: string[];

        try {
          outcomes = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : market.outcomes;
          prices = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : market.outcomePrices;
        } catch (error) {
          console.warn(`[Polymarket] Failed to parse outcomes/prices for market ${market.conditionId}:`, error);
          skippedNonBinary++;
          continue;
        }

        if (!outcomes || outcomes.length !== 2 || !prices || prices.length !== 2) {
          skippedNonBinary++;
          continue;
        }

        // Assume first outcome is "Yes" and second is "No" (common pattern)
        const yesPrice = parseFloat(prices[0]) * 100;
        const noPrice = parseFloat(prices[1]) * 100;

        // Create market with outcome prices (new API structure)
        const marketData = {
          id: market.conditionId || market.id,
          platform: 'polymarket' as const,
          ticker: market.conditionId || market.id,
          marketType: 'prediction' as const,
          title: market.question,
          yesPrice,
          noPrice,
          expiryDate: expiryDate.toISOString(),
          volume: parseFloat(market.volume || '0'),
        };

        // Log successfully added markets for debugging
        if (markets.length <= 5) { // Log first 5 added markets
          console.log(`[Polymarket] ✅ Added market ${markets.length + 1}:`, {
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

      // Log expiry date range summary
      const now = new Date();
      const maxExpiryDate = new Date(now.getTime() + maxDaysToExpiry * 24 * 60 * 60 * 1000);
      console.log(`[Polymarket] Processing window: ${now.toISOString()} to ${maxExpiryDate.toISOString()} (${maxDaysToExpiry} days)`);

      console.log(`[Polymarket] Market analysis:`);
      console.log(`  - Total markets found: ${processedCount}`);
      console.log(`  - Sports-related markets: ${sportsMarketsFound}`);
      console.log(`  - Prediction/other markets: ${predictionMarketsFound}`);
      console.log(`  - Recently created (≤90 days): ${recentMarketsFound}`);
      console.log(`  - Old markets (>90 days): ${oldMarketsFound}`);

      console.log(`[Polymarket] Processing results:`);
      console.log(`  - Added: ${markets.length}`);
      console.log(`  - Skipped (expired/future): ${skippedExpired}`);
      console.log(`  - Skipped (non-binary): ${skippedNonBinary}`);
      console.log(`  - Skipped (missing tokens): ${skippedMissingTokens}`);

      if (markets.length > 0) {
        const earliestExpiry = markets.reduce((min, m) => m.expiryDate < min ? m.expiryDate : min, markets[0].expiryDate);
        const latestExpiry = markets.reduce((max, m) => m.expiryDate > max ? m.expiryDate : max, markets[0].expiryDate);
        console.log(`[Polymarket] Added markets expiry range: ${earliestExpiry} to ${latestExpiry}`);
      }

      return markets;
    } catch (error: any) {
      console.error('[Polymarket] Error fetching markets:', error.message);
      if (error.response) {
        console.error(`[Polymarket] Response status: ${error.response.status}`);
        console.error(`[Polymarket] Response data:`, error.response.data);
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
      // CLOB API balance endpoint
      const response = await axios.get(`${BASE_URL}/balance`, {
        params: {
          address: this.walletAddress,
        },
      });

      console.log('[Polymarket] CLOB balance response:', response.data);

      // Parse the balance from response
      const balance = parseFloat(response.data.balance || response.data.collateral || response.data.available || '0');
      return Number.isFinite(balance) ? balance : 0;
    } catch (error: any) {
      console.warn('[Polymarket] CLOB balance endpoint failed:', error.response?.status || error.message);
      // Return null to indicate we couldn't get the cash balance
      return -1; // Use -1 as a sentinel value
    }
  }

  async getTotalBalance(): Promise<{ totalValue: number; availableCash: number; positionsValue: number }> {
    if (!this.walletAddress) {
      console.warn('[Polymarket] ⚠️ Wallet address not configured');
      return { totalValue: 0, availableCash: 0, positionsValue: 0 };
    }

    try {
      // Step 1: Get positions value from /value endpoint
      const positionsValueFromAPI = await this.getBalance();
      console.log(`[Polymarket] 📊 Positions value (from /value): $${positionsValueFromAPI.toFixed(2)}`);
      
      // Step 2: Try to get wallet USDC balance from blockchain
      const walletBalance = await this.getWalletBalance();
      
      if (walletBalance >= 0) {
        // Successfully got wallet balance from blockchain
        console.log(`[Polymarket] 💵 Wallet USDC balance: $${walletBalance.toFixed(2)}`);
        
        // Total = wallet balance + positions value
        const totalValue = walletBalance + positionsValueFromAPI;
        console.log(`[Polymarket] ✅ Total account value: $${totalValue.toFixed(2)}`);
        
        return {
          totalValue: totalValue,
          availableCash: walletBalance,
          positionsValue: positionsValueFromAPI
        };
      }
      
      // Blockchain query failed, try CLOB API
      console.log('[Polymarket] ⚠️ Blockchain query failed, trying CLOB API...');
      const clobCash = await this.getAvailableBalance();
      
      if (clobCash >= 0) {
        // CLOB API worked!
        console.log(`[Polymarket] 💵 Available cash (from CLOB): $${clobCash.toFixed(2)}`);
        const totalValue = clobCash + positionsValueFromAPI;
        console.log(`[Polymarket] ✅ Total account value: $${totalValue.toFixed(2)}`);
        
        return {
          totalValue: totalValue,
          availableCash: clobCash,
          positionsValue: positionsValueFromAPI
        };
      }
      
      // Both blockchain and CLOB failed - fall back to position-based calculation
      console.log('[Polymarket] ⚠️ All direct balance queries failed, using position data only...');
      
      // Get detailed positions to verify the value
      const positions = await this.getPositions();
      console.log(`[Polymarket] 📊 Found ${positions.length} positions`);
      
      if (positions.length > 0) {
        console.log(`[Polymarket] 🔍 Sample position:`, JSON.stringify(positions[0], null, 2));
      }
      
      let positionsValue = 0;
      
      for (const position of positions) {
        // Try different field names for position value
        const value = position.currentValue || position.value || position.current_value;
        
        if (value) {
          const parsedValue = parseFloat(value);
          if (Number.isFinite(parsedValue)) {
            positionsValue += parsedValue;
            console.log(`[Polymarket]   → Position value: $${parsedValue.toFixed(2)}`);
          }
        } else if (position.size && position.curPrice) {
          // Fallback: calculate from size and current price
          const calculatedValue = parseFloat(position.size) * parseFloat(position.curPrice);
          if (Number.isFinite(calculatedValue)) {
            positionsValue += calculatedValue;
            console.log(`[Polymarket]   → Calculated: ${position.size} @ $${position.curPrice} = $${calculatedValue.toFixed(2)}`);
          }
        }
      }
      
      console.log(`[Polymarket] 💰 Positions value (from positions): $${positionsValue.toFixed(2)}`);
      console.log(`[Polymarket] ⚠️ Cannot determine cash balance - showing positions only`);
      
      // We can only report positions value, cash is unknown
      return {
        totalValue: positionsValue,
        availableCash: 0, // Unknown, defaulting to 0
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

