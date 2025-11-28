import axios from 'axios';
import { ethers } from 'ethers';
import { Market } from '@/types';
import { isDryFireMode } from '@/types/dry-fire';

const BASE_URL = process.env.SXBET_API_BASE || 'https://api.sx.bet';
const SXBET_BEST_ODDS_CHUNK = 25;
const SXBET_MAX_PAGE_SIZE = 50;
const SXBET_ODDS_CHUNK_DELAY_MS = 75;
const SXBET_RATE_LIMIT_BACKOFF_MS = 500;
const SXBET_MAX_CHUNK_RETRIES = 3;
const SXBET_ODDS_REUSE_MAX_MS = 5 * 60 * 1000; // 5 minutes
const DAY_MS = 86_400_000;

// SX Network chain ID (mainnet)
const SX_NETWORK_CHAIN_ID = 4162;

// SX Network RPC URL
const SX_NETWORK_RPC = process.env.SX_NETWORK_RPC_URL || 'https://rpc.sx-rollup.gelato.digital';

// ERC20 ABI for balance queries
const erc20ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// ============================================================================
// SX.bet EIP-712 Signing Implementation
// ============================================================================

/**
 * EIP-712 Domain for SX.bet order signing
 * Per SX.bet API documentation
 */
const SXBET_EIP712_DOMAIN = {
  name: 'SX.bet',
  version: '1.0',
  chainId: SX_NETWORK_CHAIN_ID,
};

/**
 * EIP-712 Types for Fill Order
 * Based on SX.bet API documentation
 */
const SXBET_FILL_ORDER_TYPES = {
  FillOrder: [
    { name: 'orderHash', type: 'bytes32' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'fillSalt', type: 'uint256' },
    { name: 'taker', type: 'address' },
    { name: 'baseToken', type: 'address' },
    { name: 'expiry', type: 'uint256' },
  ],
};

/**
 * Parameters for building an SX.bet fill order
 */
export interface SxBetFillOrderParams {
  /** Hash of the order to fill */
  orderHash: string;
  /** Amount to fill (in USDC wei, 6 decimals) */
  takerAmount: bigint;
  /** Random salt for uniqueness */
  fillSalt: bigint;
  /** Taker's wallet address */
  taker: string;
  /** Base token address (USDC) */
  baseToken: string;
  /** Order expiry timestamp (Unix seconds) */
  expiry: number;
}

/**
 * Signed fill order ready for submission
 */
export interface SignedSxBetFillOrder {
  orderHash: string;
  takerAmount: string;
  fillSalt: string;
  taker: string;
  baseToken: string;
  expiry: number;
  signature: string;
}

/**
 * Generate a random salt for order fills
 */
function generateFillSalt(): bigint {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  let salt = BigInt(0);
  for (let i = 0; i < 32; i++) {
    salt = (salt << BigInt(8)) | BigInt(randomBytes[i]);
  }
  return salt;
}

/**
 * Sign an SX.bet fill order using EIP-712
 *
 * @param wallet ethers.js Wallet with private key
 * @param params Fill order parameters
 * @returns Signed fill order
 */
async function signSxBetFillOrder(
  wallet: ethers.Wallet,
  params: SxBetFillOrderParams
): Promise<SignedSxBetFillOrder> {
  // Build the EIP-712 message
  const message = {
    orderHash: params.orderHash,
    takerAmount: params.takerAmount.toString(),
    fillSalt: params.fillSalt.toString(),
    taker: params.taker,
    baseToken: params.baseToken,
    expiry: params.expiry,
  };

  // Sign using EIP-712
  const signature = await wallet.signTypedData(
    SXBET_EIP712_DOMAIN,
    SXBET_FILL_ORDER_TYPES,
    message
  );

  return {
    orderHash: params.orderHash,
    takerAmount: params.takerAmount.toString(),
    fillSalt: params.fillSalt.toString(),
    taker: params.taker,
    baseToken: params.baseToken,
    expiry: params.expiry,
    signature,
  };
}

/**
 * Result of a fill order submission
 */
export interface SxBetFillResult {
  success: boolean;
  fillHash?: string;
  error?: string;
  details?: any;
}

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

interface PreviousOddsEntry {
  yesPrice: number;
  noPrice: number;
  oddsAsOf?: string;
}

interface SXBetMarketFetchOptions {
  maxDaysToExpiry: number;
  endpoint?: string;
  pageSize?: number;
  maxPages?: number;
  maxMarkets?: number;
  staticParams?: Record<string, string | number | boolean | undefined>;
  previousMarkets?: Market[];
}

export interface SXBetMarketFetchStats {
  endpoint: string;
  pagesFetched: number;
  rawMarkets: number;
  withinWindow: number;
  hydratedWithOdds: number;
  reusedOdds: number;
  stopReason: string;
  pageSize: number;
  maxPages?: number;
  maxMarkets?: number;
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
 *
 * Doc divergence notes:
 * - /markets/active ignores baseToken filters, so USDC filtering must happen when
 *   hydrating odds via /orders/odds/best.
 * - Pagination is cursor-based via pageSize + paginationKey → nextKey; this
 *   implementation walks every page instead of stopping after the first payload.
 */
export class SXBetAPI {
  private apiKey: string;
  private baseToken: string; // USDC address on SX Network
  private walletAddress: string;
  private privateKey: string;
  private lastFetchStats: SXBetMarketFetchStats | null = null;

  constructor() {
    this.apiKey = process.env.SXBET_API_KEY || '';
    this.baseToken = '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B'; // USDC on SX mainnet
    this.walletAddress = process.env.SXBET_WALLET_ADDRESS || '';
    this.privateKey = process.env.SXBET_PRIVATE_KEY || '';
  }

  getLastFetchStats(): SXBetMarketFetchStats | null {
    return this.lastFetchStats;
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
  ): Promise<{
    map: Map<string, SXBetBestOddsEntry>;
    processed: number;
    stoppedEarly: boolean;
  }> {
    const bestOddsMap = new Map<string, SXBetBestOddsEntry>();
    if (!marketHashes.length) {
      return { map: bestOddsMap, processed: 0, stoppedEarly: false };
    }

    let processed = 0;
    for (let i = 0; i < marketHashes.length; i += SXBET_BEST_ODDS_CHUNK) {
      const chunk = marketHashes.slice(i, i + SXBET_BEST_ODDS_CHUNK);
      let attempt = 0;
      while (true) {
        try {
          const response = await axios.get(`${BASE_URL}/orders/odds/best`, {
            headers: this.getHeaders(),
            params: {
              marketHashes: chunk.join(','),
              baseToken: this.baseToken,
            },
          });

          const bestOdds: SXBetBestOddsEntry[] =
            response.data?.data?.bestOdds || [];
          for (const entry of bestOdds) {
            bestOddsMap.set(entry.marketHash, entry);
          }
          processed += chunk.length;
          if (SXBET_ODDS_CHUNK_DELAY_MS > 0) {
            await this.sleep(SXBET_ODDS_CHUNK_DELAY_MS);
          }
          break;
        } catch (error: any) {
          const status = error?.response?.status;
          if (status === 429) {
            attempt += 1;
            const retryMs =
              this.getRetryAfterMs(error?.response?.headers) ??
              SXBET_RATE_LIMIT_BACKOFF_MS * attempt;
            console.warn(
              `[sx.bet] Rate limited while hydrating odds (chunk=${chunk.length}, attempt=${attempt}); retrying in ${retryMs}ms.`
            );
            if (attempt >= SXBET_MAX_CHUNK_RETRIES) {
              const remaining = marketHashes.length - i;
              console.warn(
                `[sx.bet] Odds hydration aborted for ${remaining} market(s) due to persistent 429 responses.`
              );
              return {
                map: bestOddsMap,
                processed,
                stoppedEarly: true,
              };
            }
            await this.sleep(retryMs);
            continue;
          }

          console.warn(
            `[sx.bet] Best odds chunk failed (${status ?? 'unknown'}) for ${
              chunk.length
            } market(s); skipping chunk.`
          );
          processed += chunk.length;
          break;
        }
      }
    }

    return { map: bestOddsMap, processed, stoppedEarly: false };
  }

  private getRetryAfterMs(
    headers?: Record<string, string | number>
  ): number | null {
    if (!headers) {
      return null;
    }
    const retryHeader =
      (headers['retry-after'] as string | undefined) ??
      (headers['Retry-After'] as string | undefined);
    if (!retryHeader) {
      return null;
    }
    const numericValue = Number(retryHeader);
    if (Number.isFinite(numericValue)) {
      return Math.max(0, numericValue) * 1000;
    }
    const retryDate = Date.parse(retryHeader);
    if (!Number.isNaN(retryDate)) {
      const delta = retryDate - Date.now();
      return delta > 0 ? delta : 0;
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildPreviousOddsMap(
    previousMarkets?: Market[]
  ): Map<string, PreviousOddsEntry> {
    const map = new Map<string, PreviousOddsEntry>();
    if (!previousMarkets) {
      return map;
    }
    for (const market of previousMarkets) {
      if (
        typeof market.yesPrice === 'number' &&
        typeof market.noPrice === 'number' &&
        market.oddsAsOf
      ) {
        map.set(market.id, {
          yesPrice: market.yesPrice,
          noPrice: market.noPrice,
          oddsAsOf: market.oddsAsOf,
        });
      }
    }
    return map;
  }

  private tryReuseOdds(
    market: SXBetMarket,
    expiry: Date,
    previousOddsMap: Map<string, PreviousOddsEntry>,
    nowTs: number
  ): Market | null {
    const cached = previousOddsMap.get(market.marketHash);
    if (!cached || !cached.oddsAsOf) {
      return null;
    }
    const oddsTimestamp = Date.parse(cached.oddsAsOf);
    if (Number.isNaN(oddsTimestamp)) {
      return null;
    }
    if (nowTs - oddsTimestamp > SXBET_ODDS_REUSE_MAX_MS) {
      return null;
    }
    return this.createMarketPayload(
      market,
      expiry,
      cached.yesPrice,
      cached.noPrice,
      cached.oddsAsOf
    );
  }

  private createMarketPayload(
    market: SXBetMarket,
    expiry: Date,
    yesPrice: number,
    noPrice: number,
    oddsAsOf?: string
  ): Market {
    return {
      id: market.marketHash,
      platform: 'sxbet',
      ticker: market.marketHash.substring(0, 16),
      marketType: 'sportsbook',
      title: this.createFallbackTitle(market),
      yesPrice,
      noPrice,
      expiryDate: expiry.toISOString(),
      volume: 0,
      oddsAsOf,
    };
  }

  /**
   * Get active markets within expiry window
   */
  async getOpenMarkets(
    maxDaysOrOptions: number | SXBetMarketFetchOptions
  ): Promise<Market[]> {
    try {
      const options: SXBetMarketFetchOptions =
        typeof maxDaysOrOptions === 'number'
          ? { maxDaysToExpiry: maxDaysOrOptions }
          : maxDaysOrOptions;

      const endpoint = options.endpoint || '/markets/active';
      const pageSize = Math.min(
        SXBET_MAX_PAGE_SIZE,
        Math.max(1, options.pageSize ?? SXBET_MAX_PAGE_SIZE)
      );
      const maxPages =
        typeof options.maxPages === 'number' && options.maxPages > 0
          ? options.maxPages
          : undefined;
      const maxMarkets =
        typeof options.maxMarkets === 'number' && options.maxMarkets > 0
          ? options.maxMarkets
          : undefined;
      const staticParams = options.staticParams || {};

      const allMarkets: SXBetMarket[] = [];
      let paginationKey: string | undefined;
      let page = 0;
      let stopReason = 'nextKey empty';
      const seenKeys = new Set<string>();

      while (true) {
        if (maxPages && page >= maxPages) {
          stopReason = `maxPages cap (${maxPages})`;
          break;
        }

        page += 1;
        const params: Record<string, string | number | boolean> = {
          pageSize,
        };
        for (const [key, value] of Object.entries(staticParams)) {
          if (value !== undefined && value !== null) {
            params[key] = value;
          }
        }
        if (paginationKey) {
          params.paginationKey = paginationKey;
        }

        console.info(
          `[sx.bet] /markets/active page ${page} → requesting params=${JSON.stringify(
            {
              pageSize,
              paginationKey: paginationKey ?? '∅',
            }
          )}`
        );

        try {
          const response = await axios.get(`${BASE_URL}${endpoint}`, {
            headers: this.getHeaders(),
            params,
          });
          const pageMarkets: SXBetMarket[] =
            response.data?.data?.markets || [];
          const nextKey: string | null | undefined =
            response.data?.data?.nextKey;

          console.info(
            `[sx.bet] /markets/active page ${page} ← pageMarkets=${pageMarkets.length}, nextKey=${
              nextKey ?? '∅'
            }`
          );

          allMarkets.push(...pageMarkets);

          if (maxMarkets && allMarkets.length >= maxMarkets) {
            stopReason = `maxMarkets cap (${maxMarkets})`;
            break;
          }

          if (!nextKey) {
            stopReason = 'nextKey empty';
            break;
          }

          if (seenKeys.has(nextKey)) {
            stopReason = `nextKey repeated (${nextKey})`;
            break;
          }

          seenKeys.add(nextKey);
          paginationKey = nextKey;
        } catch (pageError: any) {
          stopReason = `request failed on page ${page}`;
          console.error(
            `[sx.bet] /markets/active page ${page} failed:`,
            pageError?.response?.status ||
              pageError?.message ||
              pageError
          );
          break;
        }
      }

      console.info(
        `[sx.bet] Collected ${allMarkets.length} active markets across ${page} page(s) (stop=${stopReason}).`
      );

      const previousOddsMap = this.buildPreviousOddsMap(
        options.previousMarkets
      );

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
          const orders: SXBetOrder[] = response.data?.data || [];
          fallbackOrders = orders;
          console.log(
            `[sx.bet] Retrieved ${orders.length} active orders (fallback)`
          );
        } catch (error: any) {
          console.warn(
            `[sx.bet] Orders endpoint failed (${error.response?.status}) - no fallback order data available`
          );
          fallbackOrders = [];
        }
        return fallbackOrders;
      };

      const hydratedMarketsById = new Map<string, Market>();
      const now = new Date();
      const nowTs = now.getTime();
      const maxDays = Math.max(1, options.maxDaysToExpiry ?? 5);
      const maxDate = new Date(now.getTime() + maxDays * DAY_MS);

      const prioritizedMarkets: {
        market: SXBetMarket;
        expiry: Date;
      }[] = [];

      for (const market of allMarkets) {
        const expiryDate = this.deriveExpiryDate(market);
        if (!expiryDate) {
          continue;
        }
        if (expiryDate > maxDate || expiryDate < now) {
          continue;
        }
        prioritizedMarkets.push({ market, expiry: expiryDate });
      }

      prioritizedMarkets.sort(
        (a, b) => a.expiry.getTime() - b.expiry.getTime()
      );

      const marketsNeedingOdds: {
        market: SXBetMarket;
        expiry: Date;
      }[] = [];

      for (const entry of prioritizedMarkets) {
        const reused = this.tryReuseOdds(
          entry.market,
          entry.expiry,
          previousOddsMap,
          nowTs
        );
        if (reused) {
          hydratedMarketsById.set(entry.market.marketHash, reused);
        } else {
          marketsNeedingOdds.push(entry);
        }
      }

      const withinWindow = prioritizedMarkets.length;
      const reusedOdds = hydratedMarketsById.size;

      console.info(
        `[sx.bet] Odds hydration starting: totalInWindow=${withinWindow}, reusedFromSnapshot=${reusedOdds}, toFetch=${marketsNeedingOdds.length}`
      );

      let hydratedWithOdds = hydratedMarketsById.size;

      const { map: bestOddsMap, processed, stoppedEarly } =
        await this.fetchBestOddsMap(
          marketsNeedingOdds.map((entry) => entry.market.marketHash)
        );

      if (stoppedEarly) {
        const remaining = Math.max(
          0,
          marketsNeedingOdds.length - processed
        );
        console.warn(
          `[sx.bet] Odds hydration stopped early due to rate limits; hydrated ${processed} market(s), remaining=${remaining}.`
        );
      }

      for (const entry of marketsNeedingOdds) {
        const { market, expiry } = entry;
        const bestOdds = bestOddsMap.get(market.marketHash);

        let outcomeOneOdds =
          bestOdds?.outcomeOne?.percentageOdds !== null &&
          bestOdds?.outcomeOne?.percentageOdds
            ? this.convertToDecimalOdds(
                bestOdds.outcomeOne.percentageOdds,
                false
              )
            : null;
        let outcomeTwoOdds =
          bestOdds?.outcomeTwo?.percentageOdds !== null &&
          bestOdds?.outcomeTwo?.percentageOdds
            ? this.convertToDecimalOdds(
                bestOdds.outcomeTwo.percentageOdds,
                false
              )
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
            (a: SXBetOrder, b: SXBetOrder) =>
              Number(a.percentageOdds) - Number(b.percentageOdds)
          )[0];

          const bestOutcomeTwo = outcomeTwoOrders.sort(
            (a: SXBetOrder, b: SXBetOrder) =>
              Number(a.percentageOdds) - Number(b.percentageOdds)
          )[0];

          if (!bestOutcomeOne || !bestOutcomeTwo) continue;

          outcomeOneOdds = this.convertToDecimalOdds(
            bestOutcomeOne.percentageOdds,
            true
          );
          outcomeTwoOdds = this.convertToDecimalOdds(
            bestOutcomeTwo.percentageOdds,
            true
          );
        }

        if (!outcomeOneOdds || !outcomeTwoOdds) continue;

        hydratedMarketsById.set(
          market.marketHash,
          this.createMarketPayload(
            market,
            expiry,
            outcomeOneOdds,
            outcomeTwoOdds,
            new Date().toISOString()
          )
        );
      }

      const finalMarkets: Market[] = [];
      for (const entry of prioritizedMarkets) {
        const hydrated = hydratedMarketsById.get(entry.market.marketHash);
        if (hydrated) {
          finalMarkets.push(hydrated);
        }
      }
      hydratedWithOdds = hydratedMarketsById.size;

      this.lastFetchStats = {
        endpoint,
        pagesFetched: page,
        rawMarkets: allMarkets.length,
        withinWindow,
        hydratedWithOdds,
        reusedOdds,
        stopReason,
        pageSize,
        maxPages,
        maxMarkets,
      };

      console.info(
        `[sx.bet] Markets within window=${withinWindow}, with USDC odds=${hydratedWithOdds} (reused=${reusedOdds})`
      );

      return finalMarkets;
    } catch (error) {
      console.error('Error fetching sx.bet markets:', error);
      this.lastFetchStats = null;
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
   * Place a bet on sx.bet using EIP-712 signed order fills
   *
   * Flow:
   * 1. Get best orders for the market (opposite side from desired bet)
   * 2. Build and sign EIP-712 fill order
   * 3. Submit fill to SX.bet API
   *
   * @param marketHash The market hash to bet on
   * @param side 'yes' = outcome one, 'no' = outcome two
   * @param price Target price (used for order selection, not directly in fill)
   * @param quantity Number of contracts to buy
   * @returns Success/failure with order ID if successful
   */
  async placeBet(
    marketHash: string,
    side: 'yes' | 'no', // yes = outcome one, no = outcome two
    price: number, // in cents (0-100) - used for order matching
    quantity: number // number of contracts
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    // DRY-FIRE GUARD: Never place real orders in dry-fire mode
    if (isDryFireMode()) {
      const error = '[SX.bet DRY-FIRE GUARD] Attempted to place real order in DRY_FIRE_MODE!';
      console.error(error);
      return { success: false, error };
    }

    try {
      // Validate configuration
      if (!this.privateKey) {
        return {
          success: false,
          error: 'SXBET_PRIVATE_KEY not configured - cannot sign orders',
        };
      }

      if (!this.walletAddress) {
        return {
          success: false,
          error: 'SXBET_WALLET_ADDRESS not configured - cannot place orders',
        };
      }

      // Get best orders for the market (opposite side)
      const orders = await this.getOrdersForMarket(marketHash, side);
      
      if (orders.length === 0) {
        return {
          success: false,
          error: 'No liquidity available for this market',
        };
      }

      // Use the best order (first one after sorting)
      const bestOrder = orders[0];

      // Calculate fill amount based on quantity
      // SX.bet amounts are in wei (18 decimals for the bet token)
      const fillAmountWei = BigInt(quantity) * BigInt('1000000000000000000');

      // Create wallet for signing
      const provider = new ethers.JsonRpcProvider(SX_NETWORK_RPC);
      const wallet = new ethers.Wallet(this.privateKey, provider);

      // Build fill order parameters
      const fillParams: SxBetFillOrderParams = {
        orderHash: bestOrder.orderHash,
        takerAmount: fillAmountWei,
        fillSalt: generateFillSalt(),
        taker: this.walletAddress,
        baseToken: this.baseToken,
        expiry: Math.floor(Date.now() / 1000) + 300, // 5 minute expiry
      };

      // Sign the fill order using EIP-712
      console.log(`[sx.bet] Signing fill order for market ${marketHash}...`);
      const signedOrder = await signSxBetFillOrder(wallet, fillParams);

      // Submit the fill to SX.bet API
      console.log(`[sx.bet] Submitting fill order...`);
      const fillResult = await this.submitFillOrder(signedOrder, [bestOrder.orderHash]);

      if (fillResult.success) {
        console.log(`[sx.bet] ✅ Order filled successfully: ${fillResult.fillHash}`);
        return {
          success: true,
          orderId: fillResult.fillHash,
        };
      } else {
        console.error(`[sx.bet] ❌ Fill failed: ${fillResult.error}`);
        return {
          success: false,
          error: fillResult.error,
        };
      }
    } catch (error: any) {
      console.error('[sx.bet] Error placing bet:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Submit a signed fill order to SX.bet
   */
  private async submitFillOrder(
    signedOrder: SignedSxBetFillOrder,
    orderHashes: string[]
  ): Promise<SxBetFillResult> {
    try {
      const response = await axios.post(
        `${BASE_URL}/orders/fill`,
        {
          orderHashes,
          takerAmounts: [signedOrder.takerAmount],
          taker: signedOrder.taker,
          fillSalt: signedOrder.fillSalt,
          signature: signedOrder.signature,
          baseToken: signedOrder.baseToken,
          expiry: signedOrder.expiry,
        },
        {
          headers: this.getHeaders(),
        }
      );

      const data = response.data;
      
      if (data.status === 'success' || data.data?.fillHash) {
        return {
          success: true,
          fillHash: data.data?.fillHash || data.fillHash,
          details: data,
        };
      } else {
        return {
          success: false,
          error: data.error || data.message || 'Unknown error from SX.bet',
          details: data,
        };
      }
    } catch (error: any) {
      const status = error?.response?.status;
      const errorData = error?.response?.data;

      console.error(`[sx.bet] Fill submission failed (${status}):`, errorData || error.message);

      return {
        success: false,
        error: errorData?.message || errorData?.error || error.message,
        details: errorData,
      };
    }
  }

  /**
   * Calculate the cost in USDC for a bet
   * Uses SX.bet odds format (percentage odds / 10^20)
   *
   * @param percentageOdds Raw percentage odds from SX.bet
   * @param quantity Number of contracts
   * @returns Cost in USDC (6 decimals)
   */
  calculateBetCost(percentageOdds: string, quantity: number): bigint {
    const oddsWei = BigInt(percentageOdds);
    const divisor = BigInt('100000000000000000000'); // 10^20
    
    // Cost = quantity * implied probability
    // Implied probability = odds / 10^20
    // Cost in USDC = quantity * (odds / 10^20) * 10^6 (USDC decimals)
    const costWei = (BigInt(quantity) * oddsWei * BigInt(1_000_000)) / divisor;
    
    return costWei;
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

