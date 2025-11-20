/**
 *
 * polymarket.ts
 *
 * Deep-dive revision of the Polymarket integration based on:
 *   1. Your logs
 *   2. Polymarket CLOB docs: https://docs.polymarket.com/developers/CLOB/introduction
 *   3. Your AlgoBet architecture (ARCHITECTURE.md)
 *
 * ---------------------------------------------------------------------------
 * 0. TL;DR – What your fix was doing wrong in *your* architecture
 * ---------------------------------------------------------------------------
 *
 * From your logs + ARCHITECTURE:
 *
 *   - The Bot Engine (lib/bot.ts) calls your Polymarket client (lib/markets/polymarket.ts)
 *     to fetch markets.
 *
 *   - Those markets are normalized and fed into:
 *       - Arbitrage detector (lib/arbitrage.ts)
 *       - Hot Market Tracker (lib/hot-market-tracker.ts)
 *       - Adaptive Scanner (lib/adaptive-scanner.ts)
 *
 *   - Risk constraints (maxDaysToExpiry, etc) are applied in the arbitrage layer,
 *     not inside the Polymarket client itself. So the client's job is:
 *       → return *all* tradable markets with correct metadata,
 *         then let higher-level logic filter by expiry, etc.
 *
 * Grok's "hybrid CLOB/Gamma" patch broke that in several specific ways:
 *
 *   1. **Incorrect CLOB request semantics**
 *      - Your log:
 *          [Polymarket CLOB] Trying endpoint: https://clob.polymarket.com/markets
 *            with params: { active: true, closed: false, limit: 500 }
 *
 *      - CLOB docs:
 *          GET /markets?next_cursor=<cursor>
 *
 *        → Only `next_cursor` is supported.
 *        → `active`, `closed`, `limit` are not valid query params and are ignored.
 *
 *      - Result: you are **only retrieving the first page of the CLOB markets table
 *        (oldest data)** and then *assuming* it was filtered by those params.
 *
 *      - That's why your debug dump shows 2022–2023 NFL, NBA, Oscars, etc.
 *
 *   2. **No CLOB pagination**
 *      - The CLOB API uses `next_cursor` pagination.
 *      - You fetch a single page, see only historical markets, and stop.
 *      - In reality, current markets are on *later pages*; you never reach them.
 *
 *   3. **Broken Gamma fallback condition**
 *      - From your own description:
 *          Primary: use CLOB
 *          Fallback: if no "tradable" CLOB markets → use Gamma
 *
 *      - But in the logs, we never see any `[Polymarket Gamma]` messages.
 *      - That means the fallback is only triggered on *HTTP failure* (404, etc),
 *        not on the more important case: "CLOB responded but we found 0 tradable markets".
 *
 *      - In your architecture, the Bot Engine expects:
 *          "If a platform's market feed is empty, that's a platform failure."
 *        but your client is silently swallowing that by returning 0 Polymarket markets
 *        without hitting Gamma.
 *
 *   4. **Tradability logic out of sync with docs**
 *      - CLOB docs clearly define:
 *
 *          active: boolean  // market is live
 *          closed: boolean  // market is closed/open
 *
 *      - Grok's patch used:
 *          CLOB tradable = accepting_orders || enable_order_book
 *
 *        which:
 *          - mixes Gamma semantics into CLOB
 *          - fails when CLOB data doesn't set those fields consistently
 *          - ignores the canonical `active` and `closed` flags
 *
 *   5. **Misalignment with your architecture**
 *      - AlgoBet's risk layer (maxDaysToExpiry, etc) is *not* supposed to live
 *        inside the Polymarket client.
 *
 *      - Grok's unified filtering mixed:
 *          - Tradability (CLOB/Gamma)
 *          - Expiry logic (max-days filters)
 *        in the same place, which makes debugging and reasoning harder.
 *
 *      - In your architecture you want:
 *          - Polymarket client: "give me all currently tradable markets"
 *          - Arbitrage + Risk: "among those, keep only those we actually want to trade"
 *
 * ---------------------------------------------------------------------------
 * 1. Revised strategy aligned with docs + architecture
 * ---------------------------------------------------------------------------
 *
 * This file implements a **clean, documented, architecture-aligned** Polymarket client:
 *
 *   - **Step 1 – CLOB-first:**
 *       - Fetch *all* CLOB markets using proper pagination (`next_cursor`).
 *       - Filter them client-side using:
 *           - `active === true`
 *           - `closed === false`
 *       - (Optionally discard "hopelessly old" markets, but expiry cutoffs should
 *          primarily live in `lib/arbitrage.ts` per your architecture.)
 *
 *   - **Step 2 – Gamma fallback:**
 *       - If we found 0 tradable CLOB markets:
 *           → Fetch Gamma `/markets`
 *           → Filter using Gamma's documented fields:
 *                enableOrderBook && acceptingOrders && active && !closed && !archived
 *       - Map Gamma markets into the same normalized format.
 *
 *   - **Step 3 – Normalization for AlgoBet:**
 *       - We return `NormalizedMarket` objects:
 *
 *           {
 *             platform: "polymarket",
 *             source: "clob" | "gamma",
 *             conditionId: string,
 *             slug: string,
 *             question: string,
 *             endDate: string | null,    // ISO
 *             gameStartTime?: string | null,
 *             outcomes: {
 *               tokenId?: string;
 *               name: string;
 *               price?: number | null;
 *             }[]
 *           }
 *
 *       - This fits your `lib/arbitrage.ts` / `lib/hot-market-tracker.ts` style:
 *           - platform-specific clients normalize into a common shape
 *           - arbitrage engine only cares about platform + outcomes + prices + expiry
 *
 *   - **Logging & observability:**
 *       - Uses the same tags you already log:
 *           [Polymarket CLOB], [Polymarket Gamma]
 *       - Explicitly logs:
 *           - CLOB total markets / tradable markets
 *           - When Gamma fallback is triggered
 *           - Gamma total markets / tradable markets
 *
 * ---------------------------------------------------------------------------
 * 2. Types – CLOB, Gamma, and normalized markets
 * ---------------------------------------------------------------------------
 */

export type PolymarketSource = "clob" | "gamma";

export interface NormalizedPolymarketOutcome {
  tokenId?: string;
  name: string;
  price?: number | null;
}

export interface NormalizedPolymarketMarket {
  platform: "polymarket";
  source: PolymarketSource;
  conditionId: string;
  slug: string;
  question: string;
  endDate: string | null;         // ISO string or null
  gameStartTime?: string | null;  // ISO string or null
  active: boolean;
  closed: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  acceptingOrders?: boolean;
  outcomes: NormalizedPolymarketOutcome[];
}

/**
 * CLOB side types (doc + logs hybrid)
 * Docs: https://docs.polymarket.com/developers/CLOB/markets/get-markets
 */
interface ClobToken {
  token_id: string;
  outcome: string;
  // Some deployments also include price here, but we'll be defensive:
  price?: number | string;
}

interface ClobMarket {
  condition_id: string;
  question_id: string;
  question: string;
  market_slug: string;
  active: boolean;
  closed: boolean;
  end_date_iso?: string;
  game_start_time?: string | null;
  // Seen in your logs (not always in official docs but present in practice):
  enable_order_book?: boolean;
  accepting_orders?: boolean;
  archived?: boolean;
  tokens?: ClobToken[];
  category?: string;
  icon?: string;
  image?: string;
}

interface ClobMarketsResponse {
  limit: number;
  count: number;
  next_cursor: string;
  data: ClobMarket[];
}

/**
 * Gamma side types (subset from Gamma docs + practice)
 * Docs: https://docs.polymarket.com/developers/gamma-markets-api/get-markets
 */
interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  endDate?: string;
  endDateIso?: string;
  gameStartTime?: string | null;
  active: boolean;
  closed: boolean;
  archived: boolean;
  enableOrderBook: boolean;
  acceptingOrders: boolean;
  outcomes?: string;       // JSON-encoded array of outcome names
  outcomePrices?: string;  // JSON-encoded array of prices
  clobTokenIds?: string;   // comma-separated list of token_ids
}

/* -------------------------------------------------------------------------- */

/*  Imports                                                                   */

/* -------------------------------------------------------------------------- */

import { Market } from '@/types';
import axios from 'axios';
import { ethers, parseUnits } from 'ethers';

// EIP-712 constants for Polymarket CLOB
const EIP712_DOMAIN = {
  name: 'Polymarket',
  version: '1',
  chainId: 137, // Polygon mainnet
  verifyingContract: '0x4bFb41d5B3570f767523855b53Fc8c1acb80fA8A9', // CLOB contract
};

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

/* -------------------------------------------------------------------------- */

/*  Constants                                                                */

/* -------------------------------------------------------------------------- */

const CLOB_BASE_URL = "https://clob.polymarket.com";
const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const BASE_URL = CLOB_BASE_URL; // For backward compatibility with existing methods
const DATA_API_URL = "https://data-api.polymarket.com";

/* -------------------------------------------------------------------------- */

/*  Helpers                                                                   */

/* -------------------------------------------------------------------------- */

/**
 * Safe JSON parse helper.
 */
function safeJsonParse<T = unknown>(value: string | undefined | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * ISO date normalizer.
 */
function normalizeIso(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/* -------------------------------------------------------------------------- */

/*  CLOB: fetching (with correct pagination)                                  */

/* -------------------------------------------------------------------------- */

/**
 * Fetch ALL CLOB markets using documented pagination.
 *
 *   GET /markets?next_cursor=<cursor>
 *
 * - next_cursor: "" → start
 * - final page often has next_cursor "LTE="
 */
async function fetchAllClobMarkets(): Promise<ClobMarket[]> {
  const all: ClobMarket[] = [];
  let cursor = "";
  while (true) {
    const url = new URL("/markets", CLOB_BASE_URL);
    if (cursor) {
      url.searchParams.set("next_cursor", cursor);
    }
    console.info(
      "[Polymarket CLOB] Fetching /markets page",
      cursor ? `next_cursor=${cursor}` : "(first page)"
    );
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `[Polymarket CLOB] HTTP ${res.status} fetching markets: ${res.statusText}`
      );
    }
    const body = (await res.json()) as ClobMarketsResponse;
    if (!Array.isArray(body.data)) {
      throw new Error("[Polymarket CLOB] Unexpected response shape from /markets");
    }
    all.push(...body.data);
    // End of pagination: per docs, "LTE=" marks terminal cursor.
    if (!body.next_cursor || body.next_cursor === "LTE=") {
      break;
    }
    cursor = body.next_cursor;
  }
  console.info(
    `[Polymarket CLOB] Retrieved ${all.length} markets from CLOB (unfiltered).`
  );
  return all;
}

/**
 * CLOB tradability check, aligned with docs:
 *
 *   - active === true
 *   - closed === false
 *
 * We intentionally **do not** use accepting_orders / enable_order_book here
 * as the primary source of truth, since the CLOB docs do not specify them
 * as tradability flags.
 *
 * Higher-level "expiry window" logic (maxDaysToExpiry) stays in your
 * arbitrage/risk layer per ARCHITECTURE.md.
 */
function filterTradableClobMarkets(markets: ClobMarket[]): ClobMarket[] {
  return markets.filter((m) => m.active === true && m.closed === false);
}

/**
 * Map CLOB market → NormalizedPolymarketMarket for AlgoBet.
 */
function mapClobToNormalized(markets: ClobMarket[]): NormalizedPolymarketMarket[] {
  return markets.map((m) => {
    const outcomes: NormalizedPolymarketOutcome[] = (m.tokens ?? []).map((t) => {
      let price: number | null | undefined = undefined;
      if (typeof t.price === "number") {
        price = t.price;
      } else if (typeof t.price === "string") {
        const n = Number(t.price);
        price = Number.isFinite(n) ? n : null;
      }
      return {
        tokenId: t.token_id,
        name: t.outcome,
        price,
      };
    });
    return {
      platform: "polymarket",
      source: "clob",
      conditionId: m.condition_id,
      slug: m.market_slug,
      question: m.question,
      endDate: normalizeIso(m.end_date_iso ?? null),
      gameStartTime: normalizeIso(m.game_start_time ?? null),
      active: m.active,
      closed: m.closed,
      archived: m.archived,
      enableOrderBook: m.enable_order_book,
      acceptingOrders: m.accepting_orders,
      outcomes,
    };
  });
}

/* -------------------------------------------------------------------------- */

/*  Gamma: fetching + filtering                                               */

/* -------------------------------------------------------------------------- */

/**
 * Fetch Gamma markets.
 *
 * The Gamma `/markets` endpoint is not cursor-based; it supports
 * limit+offset pagination. Here we fetch a few pages to be safe.
 */
async function fetchGammaMarkets(limit = 500, maxPages = 3): Promise<GammaMarket[]> {
  const all: GammaMarket[] = [];
  for (let page = 0; page < maxPages; page++) {
    const url = new URL("/markets", GAMMA_BASE_URL);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(page * limit));
    console.info("[Polymarket Gamma] Fetching /markets page", {
      limit,
      offset: page * limit,
    });
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `[Polymarket Gamma] HTTP ${res.status} fetching markets: ${res.statusText}`
      );
    }
    const body = (await res.json()) as GammaMarket[];
    if (!Array.isArray(body) || body.length === 0) {
      break;
    }
    all.push(...body);
    if (body.length < limit) break;
  }
  console.info(
    `[Polymarket Gamma] Retrieved ${all.length} markets from Gamma (unfiltered).`
  );
  return all;
}

/**
 * Gamma tradability filter, aligned with Gamma docs:
 *
 *   - enableOrderBook === true
 *   - acceptingOrders === true
 *   - active === true
 *   - closed === false
 *   - archived === false
 */
function filterTradableGammaMarkets(markets: GammaMarket[]): GammaMarket[] {
  return markets.filter(
    (m) =>
      m.enableOrderBook &&
      m.acceptingOrders &&
      m.active &&
      !m.closed &&
      !m.archived
  );
}

/**
 * Map Gamma market → NormalizedPolymarketMarket.
 */
function mapGammaToNormalized(markets: GammaMarket[]): NormalizedPolymarketMarket[] {
  return markets.map((m) => {
    const outcomesArr = safeJsonParse<string[]>(m.outcomes ?? "");
    const pricesArr = safeJsonParse<(number | string)[]>(m.outcomePrices ?? "");
    const tokenIds = (m.clobTokenIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const outcomes: NormalizedPolymarketOutcome[] =
      (outcomesArr ?? []).map((name, i) => {
        const rawPrice = pricesArr && pricesArr[i];
        let price: number | null | undefined = undefined;
        if (typeof rawPrice === "number") {
          price = rawPrice;
        } else if (typeof rawPrice === "string") {
          const n = Number(rawPrice);
          price = Number.isFinite(n) ? n : null;
        }
        return {
          tokenId: tokenIds[i],
          name,
          price,
        };
      });
    return {
      platform: "polymarket",
      source: "gamma",
      conditionId: m.conditionId,
      slug: m.slug,
      question: m.question,
      endDate: normalizeIso(m.endDateIso ?? m.endDate ?? null),
      gameStartTime: normalizeIso(m.gameStartTime ?? null),
      active: m.active,
      closed: m.closed,
      archived: m.archived,
      enableOrderBook: m.enableOrderBook,
      acceptingOrders: m.acceptingOrders,
      outcomes,
    };
  });
}

/* -------------------------------------------------------------------------- */

/*  PUBLIC API – what your Bot Engine should call                             */

/* -------------------------------------------------------------------------- */

/**
 * Fetch Polymarket markets with CLOB → Gamma hybrid logic.
 *
 * This is the method you should wire into your Bot Engine's market
 * scanning phase (see ARCHITECTURE "Market Scanning Phase").
 *
 * Usage (inside lib/bot.ts or wherever you aggregate markets):
 *
 *   import { fetchPolymarketMarkets } from "@/lib/markets/polymarket";
 *
 *   const polymarketMarkets = await fetchPolymarketMarkets();
 *
 *   // Then pass `polymarketMarkets` into your arbitrage matching logic.
 */
export async function fetchPolymarketMarkets(): Promise<
  NormalizedPolymarketMarket[]
> {
  // 1) Try CLOB first
  let clobMarkets: ClobMarket[] = [];
  try {
    console.info("[Polymarket CLOB] Fetching markets from CLOB API (primary)...");
    clobMarkets = await fetchAllClobMarkets();
  } catch (err) {
    console.warn(
      "[Polymarket CLOB] Error fetching markets – will consider Gamma fallback:",
      err
    );
  }
  let tradableClob: ClobMarket[] = [];
  if (clobMarkets.length > 0) {
    tradableClob = filterTradableClobMarkets(clobMarkets);
    console.info(
      `[Polymarket CLOB] Found ${clobMarkets.length} CLOB markets, ` +
        `${tradableClob.length} tradable after filtering (active && !closed).`
    );
  } else {
    console.warn("[Polymarket CLOB] No CLOB markets returned at all.");
  }
  if (tradableClob.length > 0) {
    console.info(
      "[Polymarket] Using CLOB markets only (Gamma fallback not needed)."
    );
    return mapClobToNormalized(tradableClob);
  }
  // 2) No tradable CLOB markets → Gamma fallback
  console.warn(
    "[Polymarket CLOB] No tradable CLOB markets found, falling back to Gamma API..."
  );
  let gammaMarkets: GammaMarket[] = [];
  try {
    gammaMarkets = await fetchGammaMarkets();
  } catch (err) {
    console.error("[Polymarket Gamma] Failed to fetch markets:", err);
    // At this point we truly have nothing; surface as "no markets"
    return [];
  }
  const tradableGamma = filterTradableGammaMarkets(gammaMarkets);
  console.info(
    `[Polymarket Gamma] Found ${gammaMarkets.length} Gamma markets, ` +
      `${tradableGamma.length} tradable after filtering.`
  );
  return mapGammaToNormalized(tradableGamma);
}

/* -------------------------------------------------------------------------- */

/*  HOW THIS FIXES GROK'S ERROR IN YOUR ARCHITECTURE                          */

/* -------------------------------------------------------------------------- *
 *
 * 1. CLOB request is now doc-compliant:
 *      - No fake filters in query params
 *      - Full pagination via `next_cursor`
 *
 *    → You no longer get only the oldest 50 historical markets.
 *    → You actually reach the *current* CLOB markets that matter.
 *
 * 2. Fallback condition is now correct:
 *      - We only skip Gamma if we find **tradable** CLOB markets:
 *
 *          tradableClob.length > 0
 *
 *      - If CLOB returns only historical / closed markets:
 *
 *          tradableClob.length === 0 → Gamma fallback triggers
 *
 *    → This directly addresses what you saw in logs:
 *       "CLOB returned data, but all old; Gamma never called."
 *
 * 3. Tradability logic matches docs:
 *      - CLOB: active && !closed
 *      - Gamma: enableOrderBook && acceptingOrders && active && !closed && !archived
 *
 *    → No more mixing CLOB/Gamma-specific concepts in the wrong layer.
 *
 * 4. Clean separation of concerns with AlgoBet's architecture:
 *      - This module is **only** responsible for:
 *          - discovering currently tradable Polymarket markets
 *          - normalizing them into a shared internal representation
 *
 *      - Risk and expiry filtering (maxDaysToExpiry, etc) remain:
 *          - in `lib/arbitrage.ts` and related risk modules,
 *            as per ARCHITECTURE.md.
 *
 * 5. Better observability:
 *      - Clear logs for:
 *          - CLOB total vs tradable market counts
 *          - when Gamma fallback is triggered
 *          - Gamma total vs tradable market counts
 *
 *    → Next time something is off, your logs will show *exactly* where.
 *
 * -------------------------------------------------------------------------- *
 * Drop this file in `lib/markets/polymarket.ts`, wire `fetchPolymarketMarkets`
 * into your Bot Engine's market aggregation, and you should see:
 *
 *   - "[Polymarket CLOB] Found X CLOB markets, Y tradable..."
 *   - OR, if CLOB is stale:
 *     "[Polymarket CLOB] No tradable CLOB markets found, falling back to Gamma..."
 *     "[Polymarket Gamma] Found A Gamma markets, B tradable..."
 *
 * And your scan summary should finally show:
 *
 *   Found 200 Kalshi, <non-zero> Polymarket, 32 sx.bet markets
 *
 * instead of "0 Polymarket".
 *
 * -------------------------------------------------------------------------- */

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
    // Use the new CLOB-first implementation with proper pagination and fallback
    const normalizedMarkets = await fetchPolymarketMarkets();

    // Convert normalized markets to the Market[] format expected by the rest of the system
    const markets: Market[] = [];
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + maxDaysToExpiry);
    const now = new Date();

    for (const market of normalizedMarkets) {
      // Apply expiry filtering here (as per architecture - this is where risk logic lives)
      if (market.endDate) {
        const expiryDate = new Date(market.endDate);
        if (expiryDate < now || expiryDate > maxDate) {
          continue; // Skip expired or too distant markets
        }
      }

      // Find Yes/No outcomes and their prices
      const yesOutcome = market.outcomes.find(o => o.name.toLowerCase().includes('yes') || o.name.toLowerCase().includes('y'));
      const noOutcome = market.outcomes.find(o => o.name.toLowerCase().includes('no') || o.name.toLowerCase().includes('n'));

      // For binary markets, assume first outcome is Yes, second is No if we can't identify by name
      const yesPrice = yesOutcome?.price ? Math.round(yesOutcome.price * 100) : Math.round((market.outcomes[0]?.price || 0) * 100);
      const noPrice = noOutcome?.price ? Math.round(noOutcome.price * 100) : Math.round((market.outcomes[1]?.price || 0) * 100);

      const marketData: Market = {
        id: market.conditionId,
        platform: 'polymarket' as const,
        ticker: market.conditionId,
        marketType: 'prediction' as const,
        title: market.question,
        yesPrice,
        noPrice,
        expiryDate: market.endDate || new Date().toISOString(),
        volume: 0, // Volume not available in normalized format
      };

      markets.push(marketData);
    }

    console.log(`[Polymarket] Converted ${normalizedMarkets.length} normalized markets to ${markets.length} legacy format markets`);
    return markets;
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
      const signature = await wallet.signTypedData(EIP712_DOMAIN, EIP712_TYPES, orderData);

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

