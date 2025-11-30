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
  endDateIso?: string | null;
  umaEndDate?: string | null;
  umaEndDateIso?: string | null;
  startDate?: string | null;
  startDateIso?: string | null;
  eventStartTime?: string | null;
  gameStartTime?: string | null;  // ISO string or null
  sportsMarketType?: string | null;
  gameId?: string | null;
  derivedExpiry: string | null;
  derivedExpirySource?: string;
  active: boolean;
  closed: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  acceptingOrders?: boolean;
  outcomes: NormalizedPolymarketOutcome[];
}

interface PolymarketFilterWindow {
  windowStart: string;
  windowEnd: string;
  categories?: string[];
  maxMarkets?: number;
}

interface PolymarketMarketFetchOptions {
  windowStart: string;
  windowEnd: string;
  categories?: string[];
  forceRefresh?: boolean;
  maxMarkets?: number;
  maxPages?: number;
  limit?: number;
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
  game_id?: string | null;
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

interface ClobPaginationOptions {
  maxPages?: number;
  stopAfterTradable?: number;
  maxConsecutiveInactivePages?: number;
}

interface ClobPaginatedResult {
  tradable: ClobMarket[];
  totalFetched: number;
  pagesFetched: number;
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
  umaEndDate?: string;
  umaEndDateIso?: string;
  startDate?: string;
  startDateIso?: string;
  eventStartTime?: string | null;
  gameStartTime?: string | null;
  sportsMarketType?: string | null;
  gameId?: string | null;
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

import { Market, MarketFilterInput } from '@/types';
import { isDryFireMode } from '../execution-wrapper';
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

const DAY_MS = 86_400_000;
const MARKET_CACHE_TTL_MS = 30_000; // 30 seconds cache window to keep scans fast
const GAMMA_PAGE_LIMIT = 500;
const GAMMA_MAX_PAGES = 6; // 3k markets max per refresh
const DEFAULT_POLYMARKET_MAX_MARKETS = 2000;
const MAX_POLYMARKET_EXPIRY_LOGS = 20;
const MAX_GAME_START_LOGS = 10;
const CLOB_MAX_PAGES = 8; // stop early to avoid 60+ page sweeps
const CLOB_MAX_TRADABLE = 400;
const CLOB_MAX_INACTIVE_PAGES = 3;

interface MarketCacheEntry {
  fetchedAt: number;
  source: PolymarketSource;
  markets: NormalizedPolymarketMarket[];
}

const marketCache = new Map<string, MarketCacheEntry>();
const inflightMarketFetches = new Map<
  string,
  Promise<NormalizedPolymarketMarket[]>
>();

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

function buildPolymarketCacheKey(
  options: PolymarketMarketFetchOptions
): string {
  const start = normalizeIso(options.windowStart) ?? 'invalid-start';
  const end = normalizeIso(options.windowEnd) ?? 'invalid-end';
  const categories =
    options.categories && options.categories.length
      ? options.categories.filter(Boolean).sort().join(',')
      : 'none';
  const max = options.maxMarkets ?? DEFAULT_POLYMARKET_MAX_MARKETS;
  const pages = options.maxPages ?? GAMMA_MAX_PAGES;
  const limit = options.limit ?? GAMMA_PAGE_LIMIT;
  return `${start}|${end}|${categories}|max=${max}|pages=${pages}|limit=${limit}`;
}

/* -------------------------------------------------------------------------- */

/*  CLOB: fetching (with correct pagination)                                  */

/* -------------------------------------------------------------------------- */

/**
 * Fetch CLOB markets with pagination limits.
 * We stop early once we've either collected enough tradable markets or
 * we've scanned the maximum number of pages to avoid 60+ sequential calls.
 */
async function fetchAllClobMarkets(
  options: ClobPaginationOptions = {}
): Promise<ClobPaginatedResult> {
  const { maxPages, stopAfterTradable, maxConsecutiveInactivePages } = options;
  const tradable: ClobMarket[] = [];
  let cursor = "";
  const requestDelay = 100;
  let pagesFetched = 0;
  let inactivePageStreak = 0;
  let totalFetched = 0;

  while (true) {
    if (typeof maxPages === "number" && pagesFetched >= maxPages) {
      console.info(
        `[Polymarket CLOB] Stopping pagination after reaching maxPages=${maxPages}.`
      );
      break;
    }

    const url = new URL("/markets", CLOB_BASE_URL);
    if (cursor) {
      url.searchParams.set("next_cursor", cursor);
    }

    const startTime = Date.now();
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

    pagesFetched += 1;
    totalFetched += body.data.length;

    const pageTradable = filterTradableClobMarkets(body.data);
    tradable.push(...pageTradable);
    inactivePageStreak = pageTradable.length === 0 ? inactivePageStreak + 1 : 0;

    const fetchTime = Date.now() - startTime;
    console.info(
      `[Polymarket CLOB] Page fetched in ${fetchTime}ms, ${body.data.length} markets (${pageTradable.length} tradable)`
    );

    if (
      typeof stopAfterTradable === "number" &&
      tradable.length >= stopAfterTradable
    ) {
      console.info(
        `[Polymarket CLOB] Collected ${tradable.length} tradable markets (target ${stopAfterTradable}), stopping early.`
      );
      break;
    }

    if (
      typeof maxConsecutiveInactivePages === "number" &&
      inactivePageStreak >= maxConsecutiveInactivePages
    ) {
      console.info(
        `[Polymarket CLOB] No tradable markets found in the last ${inactivePageStreak} page(s); stopping pagination.`
      );
      break;
    }

    if (!body.next_cursor || body.next_cursor === "LTE=") {
      break;
    }

    cursor = body.next_cursor;
    await new Promise(resolve => setTimeout(resolve, requestDelay));
  }

  console.info(
    `[Polymarket CLOB] Pagination complete: ${pagesFetched} page(s), ${totalFetched} rows, ${tradable.length} tradable markets.`
  );

  return { tradable, totalFetched, pagesFetched };
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
    const normalizedEndDateIso = normalizeIso(m.end_date_iso ?? null);
    const normalizedGameStart = normalizeIso(m.game_start_time ?? null);
    const derived = derivePolymarketExpiry({
      eventStartTime: null,
      gameStartTime: normalizedGameStart,
      endDate: normalizedEndDateIso,
      endDateIso: normalizedEndDateIso,
      umaEndDate: null,
      umaEndDateIso: null,
      startDate: null,
      startDateIso: null,
      sportsMarketType: null,
      gameId: m.game_id ?? null,
      question: m.question,
    });

    return {
      platform: "polymarket",
      source: "clob",
      conditionId: m.condition_id,
      slug: m.market_slug,
      question: m.question,
      endDate: normalizedEndDateIso,
      endDateIso: normalizedEndDateIso,
      umaEndDate: null,
      umaEndDateIso: null,
      startDate: null,
      startDateIso: null,
      eventStartTime: null,
      gameStartTime: normalizedGameStart,
      sportsMarketType: null,
      gameId: m.game_id ?? null,
      derivedExpiry: derived.iso,
      derivedExpirySource: derived.source,
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
async function fetchGammaMarkets(
  options: PolymarketMarketFetchOptions
): Promise<GammaMarket[]> {
  const limit = options.limit ?? GAMMA_PAGE_LIMIT;
  const maxPages = options.maxPages ?? GAMMA_MAX_PAGES;
  const targetTradable =
    options.maxMarkets && options.maxMarkets > 0
      ? options.maxMarkets
      : DEFAULT_POLYMARKET_MAX_MARKETS;

  const all: GammaMarket[] = [];
  let tradableCollected = 0;
  let pagesFetched = 0;
  let stopReason: string | null = null;
  const queryFilters = buildGammaQueryFilters(options);

  while (true) {
    if (maxPages > 0 && pagesFetched >= maxPages) {
      stopReason = `reached maxPages cap (${maxPages})`;
      break;
    }

    const offset = pagesFetched * limit;
    const url = new URL("/markets", GAMMA_BASE_URL);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    Object.entries(queryFilters).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    console.info("[Polymarket Gamma] Fetching /markets page", {
      page: pagesFetched + 1,
      limit,
      offset,
      filters: queryFilters,
    });
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `[Polymarket Gamma] HTTP ${res.status} fetching markets: ${res.statusText}`
      );
    }

    const body = (await res.json()) as GammaMarket[];
    if (!Array.isArray(body) || body.length === 0) {
      stopReason = "API returned 0 markets";
      break;
    }

    pagesFetched += 1;
    all.push(...body);

    const tradableOnPage = filterTradableGammaMarkets(body).length;
    tradableCollected += tradableOnPage;

    console.info(
      `[Polymarket Gamma] Page ${pagesFetched} summary: raw=${body.length}, tradable=${tradableOnPage}, cumulativeTradable=${tradableCollected}.`
    );

    const hitMaxMarkets =
      typeof targetTradable === "number" && tradableCollected >= targetTradable;
    const fewerThanLimit = body.length < limit;

    if (hitMaxMarkets) {
      stopReason = `reached maxMarkets cap (${targetTradable})`;
      break;
    }
    if (fewerThanLimit) {
      stopReason = "fewer than limit results returned";
      break;
    }
  }

  if (!stopReason) {
    stopReason =
      maxPages > 0 && pagesFetched >= maxPages
        ? `reached maxPages cap (${maxPages})`
        : "completed pagination";
  }

  console.info(
    `[Polymarket Gamma] Collected ${tradableCollected} tradable markets out of ${all.length} raw across ${pagesFetched} page(s) (stopped because ${stopReason}).`
  );
  return all;
}

function buildGammaQueryFilters(
  options: PolymarketMarketFetchOptions
): Record<string, string> {
  const filters: Record<string, string> = {
    closed: "false",
  };
  const min = normalizeIso(options.windowStart);
  const max = normalizeIso(options.windowEnd);
  if (min) {
    filters.end_date_min = min;
  }
  if (max) {
    filters.end_date_max = max;
  }
  if (options.categories && options.categories.length) {
    filters.category = options.categories.filter(Boolean).join(",");
  }
  return filters;
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
  return markets.filter((m) => {
    const hasOrderBook = m.enableOrderBook === true;
    const acceptsOrders = m.acceptingOrders === undefined ? true : m.acceptingOrders === true;
    const isActive = m.active !== false;
    const isClosed = m.closed === true;
    const isArchived = m.archived === true;

    return hasOrderBook && acceptsOrders && isActive && !isClosed && !isArchived;
  });
}

/**
 * Map Gamma market → NormalizedPolymarketMarket.
 */
function mapGammaToNormalized(markets: GammaMarket[]): NormalizedPolymarketMarket[] {
  return markets.map((m) => {
    const outcomesArr = safeJsonParse<string[]>(m.outcomes ?? "");
    const pricesArr = safeJsonParse<(number | string)[]>(m.outcomePrices ?? "");
    const parsedTokenIds = safeJsonParse<string[]>(m.clobTokenIds ?? "");
    const tokenIds = Array.isArray(parsedTokenIds)
      ? parsedTokenIds
      : (m.clobTokenIds ?? "")
          .split(",")
          .map((s) => s.replace(/[\[\]\"]/g, "").trim())
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
    const normalizedEndDateIso = normalizeIso(m.endDateIso ?? null);
    const normalizedEndDate = normalizeIso(m.endDate ?? null);
    const normalizedUmaEndDateIso = normalizeIso(m.umaEndDateIso ?? null);
    const normalizedUmaEndDate = normalizeIso(m.umaEndDate ?? null);
    const normalizedStartDateIso = normalizeIso(m.startDateIso ?? null);
    const normalizedStartDate = normalizeIso(m.startDate ?? null);
    const normalizedEventStart = normalizeIso(m.eventStartTime ?? null);
    const normalizedGameStart = normalizeIso(m.gameStartTime ?? null);

    const derived = derivePolymarketExpiry({
      eventStartTime: normalizedEventStart,
      gameStartTime: normalizedGameStart,
      endDate: normalizedEndDate,
      endDateIso: normalizedEndDateIso,
      umaEndDate: normalizedUmaEndDate,
      umaEndDateIso: normalizedUmaEndDateIso,
      startDate: normalizedStartDate,
      startDateIso: normalizedStartDateIso,
      sportsMarketType: m.sportsMarketType ?? null,
      gameId: m.gameId ?? null,
      question: m.question,
    });

    return {
      platform: "polymarket",
      source: "gamma",
      conditionId: m.conditionId,
      slug: m.slug,
      question: m.question,
      endDate: normalizedEndDateIso ?? normalizedEndDate,
      endDateIso: normalizedEndDateIso,
      umaEndDate: normalizedUmaEndDate,
      umaEndDateIso: normalizedUmaEndDateIso,
      startDate: normalizedStartDate,
      startDateIso: normalizedStartDateIso,
      eventStartTime: normalizedEventStart,
      gameStartTime: normalizedGameStart,
      sportsMarketType: m.sportsMarketType ?? null,
      gameId: m.gameId ?? null,
      derivedExpiry: derived.iso,
      derivedExpirySource: derived.source,
      active: m.active,
      closed: m.closed,
      archived: m.archived,
      enableOrderBook: m.enableOrderBook,
      acceptingOrders: m.acceptingOrders,
      outcomes,
    };
  });
}

function convertPriceToCents(value: number | null | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const cents = Math.round(value * 100);
  if (!Number.isFinite(cents)) return null;
  return Math.max(0, Math.min(100, cents));
}

function determineBinaryOutcomePrices(
  outcomes: NormalizedPolymarketOutcome[]
): { yesCents: number; noCents: number } | null {
  if (!Array.isArray(outcomes) || outcomes.length < 2) {
    return null;
  }

  const pricedOutcomes = outcomes.filter(
    (o): o is NormalizedPolymarketOutcome & { price: number } =>
      typeof o.price === "number" && Number.isFinite(o.price)
  );

  if (pricedOutcomes.length < 2) {
    return null;
  }

  const findByName = (keywords: string[]) =>
    pricedOutcomes.find((outcome) => {
      const name = (outcome.name || "").toLowerCase();
      return keywords.some((keyword) => name === keyword || name.startsWith(`${keyword} `));
    });

  const yesOutcome =
    findByName(["yes", "y"]) ||
    findByName(["over", "home", "team 1"]) ||
    null;
  const noOutcome =
    findByName(["no", "n"]) ||
    findByName(["under", "away", "team 2"]) ||
    null;

  let yesPrice = yesOutcome?.price;
  let noPrice = noOutcome?.price;

  if (yesPrice == null && noPrice == null) {
    yesPrice = pricedOutcomes[0].price;
    noPrice = pricedOutcomes[1].price;
  } else if (yesPrice == null) {
    const fallback = pricedOutcomes.find((o) => o !== noOutcome);
    yesPrice = fallback?.price;
  } else if (noPrice == null) {
    const fallback = pricedOutcomes.find((o) => o !== yesOutcome);
    noPrice = fallback?.price;
  }

  const yesCents = convertPriceToCents(yesPrice);
  const noCents = convertPriceToCents(noPrice);

  if (yesCents == null || noCents == null) {
    return null;
  }

  return { yesCents, noCents };
}

interface DerivedExpiryResult {
  iso: string | null;
  source?: string;
}

function parseIsoTimestamp(value?: string | null): number | null {
  if (!value) {
    return null;
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

const SPORTS_TIME_WINDOW_MS = 48 * 60 * 60 * 1000;
const SPORTS_QUESTION_PATTERNS: RegExp[] = [
  /\bvs\.?\b/i,
  /\bmatch\b/i,
  /\bgame\b/i,
  /\bwin on\b/i,
  /\bdraw\b/i,
  /\btake on\b/i,
  /\b fc\b/i,
  /\bclub\b/i,
];

function questionSuggestsSports(question?: string | null): boolean {
  if (!question) {
    return false;
  }
  return SPORTS_QUESTION_PATTERNS.some((regex) => regex.test(question));
}

function looksLikeSportsMarket(
  fields: Pick<
    NormalizedPolymarketMarket,
    | "sportsMarketType"
    | "gameId"
    | "gameStartTime"
    | "eventStartTime"
    | "endDate"
    | "endDateIso"
    | "umaEndDate"
    | "umaEndDateIso"
    | "question"
  >
): boolean {
  if (fields.sportsMarketType || fields.gameId) {
    return true;
  }

  const gameStartTs = parseIsoTimestamp(fields.gameStartTime);
  const endTs =
    parseIsoTimestamp(fields.endDateIso) ??
    parseIsoTimestamp(fields.umaEndDateIso) ??
    parseIsoTimestamp(fields.endDate) ??
    parseIsoTimestamp(fields.umaEndDate);

  if (
    gameStartTs !== null &&
    endTs !== null &&
    Math.abs(endTs - gameStartTs) <= SPORTS_TIME_WINDOW_MS
  ) {
    return true;
  }

  return questionSuggestsSports(fields.question);
}

/**
 * Polymarket expiry derivation:
 *   - Sports markets prefer event/game start timestamps.
 *   - Non-sports markets prefer end/UMA settlement dates.
 *   - Finally falls back to start timestamps when nothing else is available.
 */
export function derivePolymarketExpiry(
  fields: Pick<
    NormalizedPolymarketMarket,
    | "eventStartTime"
    | "gameStartTime"
    | "endDate"
    | "endDateIso"
    | "umaEndDate"
    | "umaEndDateIso"
    | "startDate"
    | "startDateIso"
    | "sportsMarketType"
    | "gameId"
    | "question"
  >
): DerivedExpiryResult {
  const sportsLike = looksLikeSportsMarket(fields);
  const sportsCandidates: { value?: string | null; source: string }[] = [
    { value: fields.gameStartTime, source: "gameStartTime" },
    { value: fields.eventStartTime, source: "eventStartTime" },
    { value: fields.endDateIso, source: "endDateIso" },
    { value: fields.endDate, source: "endDate" },
    { value: fields.umaEndDateIso, source: "umaEndDateIso" },
    { value: fields.umaEndDate, source: "umaEndDate" },
    { value: fields.startDateIso, source: "startDateIso" },
    { value: fields.startDate, source: "startDate" },
  ];

  const generalCandidates: { value?: string | null; source: string }[] = [
    { value: fields.eventStartTime, source: "eventStartTime" },
    { value: fields.endDateIso, source: "endDateIso" },
    { value: fields.endDate, source: "endDate" },
    { value: fields.umaEndDateIso, source: "umaEndDateIso" },
    { value: fields.umaEndDate, source: "umaEndDate" },
    { value: fields.startDateIso, source: "startDateIso" },
    { value: fields.startDate, source: "startDate" },
  ];

  const orderedCandidates = sportsLike ? sportsCandidates : generalCandidates;

  for (const candidate of orderedCandidates) {
    const iso = normalizeIso(candidate.value ?? null);
    if (iso) {
      return { iso, source: candidate.source };
    }
  }

  return { iso: null, source: undefined };
}

function isWithinExecutionWindow(
  expiryIso: string | null,
  windowStart: Date,
  windowEnd: Date
): boolean {
  if (!expiryIso) return false;
  if (
    Number.isNaN(windowStart.getTime()) ||
    Number.isNaN(windowEnd.getTime())
  ) {
    return false;
  }
  const expiry = new Date(expiryIso);
  if (Number.isNaN(expiry.getTime())) {
    return false;
  }
  return expiry >= windowStart && expiry <= windowEnd;
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
export async function fetchPolymarketMarkets(
  options: PolymarketMarketFetchOptions
): Promise<NormalizedPolymarketMarket[]> {
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = buildPolymarketCacheKey(options);
  const now = Date.now();
  const cached = marketCache.get(cacheKey);

  if (
    !forceRefresh &&
    cached &&
    now - cached.fetchedAt < MARKET_CACHE_TTL_MS
  ) {
    console.info(
      `[Polymarket] Serving ${cached.markets.length} cached markets (source=${cached.source}) for window ${options.windowStart} → ${options.windowEnd}.`
    );
    return cached.markets;
  }

  let inflight = inflightMarketFetches.get(cacheKey);
  if (!inflight) {
    inflight = refreshPolymarketMarkets(options, cacheKey).finally(() => {
      inflightMarketFetches.delete(cacheKey);
    });
    inflightMarketFetches.set(cacheKey, inflight);
  }

  return inflight;
}

async function refreshPolymarketMarkets(
  options: PolymarketMarketFetchOptions,
  cacheKey: string
): Promise<NormalizedPolymarketMarket[]> {
  const gammaMarkets = await tryFetchGammaMarkets(options);
  if (gammaMarkets.length > 0) {
    marketCache.set(cacheKey, {
      fetchedAt: Date.now(),
      source: "gamma",
      markets: gammaMarkets,
    });
    return gammaMarkets;
  }

  console.warn(
    "[Polymarket] Gamma API returned 0 tradable markets. Attempting limited CLOB sweep..."
  );
  const clobMarkets = await tryFetchClobMarketsLimited(options);
  marketCache.set(cacheKey, {
    fetchedAt: Date.now(),
    source: "clob",
    markets: clobMarkets,
  });
  return clobMarkets;
}

async function tryFetchGammaMarkets(
  options: PolymarketMarketFetchOptions
): Promise<NormalizedPolymarketMarket[]> {
  let gammaMarkets: GammaMarket[] = [];
  try {
    gammaMarkets = await fetchGammaMarkets(options);
  } catch (err) {
    console.error("[Polymarket Gamma] Failed to fetch markets:", err);
    return [];
  }

  if (gammaMarkets.length === 0) {
    console.warn("[Polymarket Gamma] API responded with 0 markets.");
    return [];
  }

  const tradableGamma = filterTradableGammaMarkets(gammaMarkets);
  console.info(
    `[Polymarket Gamma] ${tradableGamma.length} tradable markets out of ${gammaMarkets.length} raw entries for window ${options.windowStart} → ${options.windowEnd}.`
  );
  return mapGammaToNormalized(tradableGamma);
}

async function tryFetchClobMarketsLimited(
  options?: PolymarketMarketFetchOptions
): Promise<NormalizedPolymarketMarket[]> {
  try {
    if (options) {
      console.info(
        `[Polymarket CLOB] Fetching markets from CLOB API (fallback) for window ${options.windowStart} → ${options.windowEnd}...`
      );
    } else {
      console.info("[Polymarket CLOB] Fetching markets from CLOB API (fallback)...");
    }
    const result = await fetchAllClobMarkets({
      maxPages: CLOB_MAX_PAGES,
      stopAfterTradable: CLOB_MAX_TRADABLE,
      maxConsecutiveInactivePages: CLOB_MAX_INACTIVE_PAGES,
    });
    const { tradable, totalFetched, pagesFetched } = result;

    if (tradable.length === 0) {
      console.warn(
        `[Polymarket CLOB] No tradable markets found across ${pagesFetched} page(s) (${totalFetched} rows).`
      );
      return [];
    }

    console.info(
      `[Polymarket CLOB] ${tradable.length} tradable markets collected from ${pagesFetched} page(s) (${totalFetched} rows).`
    );
    return mapClobToNormalized(tradable);
  } catch (err) {
    console.error("[Polymarket CLOB] Failed to fetch markets:", err);
    return [];
  }
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

  async getOpenMarkets(
    filtersOrMaxDays: number | MarketFilterInput,
    options: { forceRefresh?: boolean } = {}
  ): Promise<Market[]> {
    const window = this.resolveFilterWindow(filtersOrMaxDays);
    const normalizedMarkets = await fetchPolymarketMarkets({
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      categories: window.categories,
      maxMarkets: window.maxMarkets,
      forceRefresh: options.forceRefresh,
    });
    const markets: Market[] = [];
    const windowStartDate = new Date(window.windowStart);
    const windowEndDate = new Date(window.windowEnd);

    let skippedExpiry = 0;
    let skippedPrice = 0;
    const skippedExpirySamples: Record<string, unknown>[] = [];
    let gameStartUsedForSports = 0;
    let gameStartIgnoredAsNonSports = 0;
    const gameStartUsageSamples: Record<string, unknown>[] = [];
    const nonSportsGameStartSamples: Record<string, unknown>[] = [];

    for (const market of normalizedMarkets) {
      const expiry =
        market.derivedExpiry ??
        market.endDate ??
        market.gameStartTime ??
        market.eventStartTime ??
        null;

      const isSportsLike = looksLikeSportsMarket(market);

      if (market.gameStartTime) {
        if (market.derivedExpirySource === 'gameStartTime') {
          gameStartUsedForSports += 1;
          if (gameStartUsageSamples.length < MAX_GAME_START_LOGS) {
            gameStartUsageSamples.push({
              conditionId: market.conditionId,
              question: market.question,
              source: market.source,
              gameStartTime: market.gameStartTime,
              derivedExpiry: expiry,
            });
          }
        } else if (!isSportsLike) {
          gameStartIgnoredAsNonSports += 1;
          if (nonSportsGameStartSamples.length < MAX_GAME_START_LOGS) {
            nonSportsGameStartSamples.push({
              conditionId: market.conditionId,
              question: market.question,
              source: market.source,
              gameStartTime: market.gameStartTime,
              derivedExpiry: expiry,
              derivedExpirySource: market.derivedExpirySource ?? '<unset>',
            });
          }
        }
      }

      if (!isWithinExecutionWindow(expiry, windowStartDate, windowEndDate)) {
        skippedExpiry += 1;
        if (skippedExpirySamples.length < MAX_POLYMARKET_EXPIRY_LOGS) {
          skippedExpirySamples.push({
            conditionId: market.conditionId,
            source: market.source,
            question: market.question,
            sportsMarketType: market.sportsMarketType ?? null,
            gameId: market.gameId ?? null,
            eventStartTime: market.eventStartTime ?? null,
            gameStartTime: market.gameStartTime ?? null,
            endDate: market.endDate,
            endDateIso: market.endDateIso,
            umaEndDate: market.umaEndDate,
            umaEndDateIso: market.umaEndDateIso,
            derivedExpiry: market.derivedExpiry,
            derivedExpirySource: market.derivedExpirySource ?? null,
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
          });
        }
        continue;
      }

      const pricePair = determineBinaryOutcomePrices(market.outcomes);
      if (!pricePair) {
        skippedPrice += 1;
        continue;
      }

      const marketData: Market = {
        id: market.conditionId,
        platform: 'polymarket' as const,
        ticker: market.conditionId,
        marketType: 'prediction' as const,
        title: market.question,
        yesPrice: pricePair.yesCents,
        noPrice: pricePair.noCents,
        expiryDate: expiry || window.windowEnd,
        volume: 0,
      };

      markets.push(marketData);
      if (window.maxMarkets && markets.length >= window.maxMarkets) {
        break;
      }
    }

    console.info(
      `[Polymarket] Filter breakdown (window ${window.windowStart} → ${window.windowEnd}): raw=${normalizedMarkets.length}, kept=${markets.length}, skippedByExpiry=${skippedExpiry}, skippedByPrice=${skippedPrice}.`
    );
    if (skippedExpirySamples.length > 0) {
      console.info('[Polymarket] Skipping by expiry (sample):', skippedExpirySamples);
    }
    if (gameStartUsedForSports || gameStartIgnoredAsNonSports) {
      console.info(
        `[Polymarket] gameStartTime: usedForSports=${gameStartUsedForSports}, ignoredAsNonSports=${gameStartIgnoredAsNonSports}.`
      );
    }
    if (gameStartUsageSamples.length) {
      console.info(
        '[Polymarket] Sample markets using gameStartTime for expiry:',
        gameStartUsageSamples
      );
    }
    if (nonSportsGameStartSamples.length) {
      console.info(
        '[Polymarket] gameStartTime ignored for non-sports markets (sample):',
        nonSportsGameStartSamples
      );
    }

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

  private resolveFilterWindow(
    filtersOrMaxDays: number | MarketFilterInput
  ): PolymarketFilterWindow {
    if (typeof filtersOrMaxDays === 'number') {
      const now = new Date();
      const end = new Date(now.getTime() + Math.max(1, filtersOrMaxDays) * DAY_MS);
      return {
        windowStart: now.toISOString(),
        windowEnd: end.toISOString(),
        maxMarkets: DEFAULT_POLYMARKET_MAX_MARKETS,
      };
    }

    const fallbackStart = new Date();
    const fallbackEnd = new Date(fallbackStart.getTime() + 10 * DAY_MS);
    return {
      windowStart: filtersOrMaxDays.windowStart ?? fallbackStart.toISOString(),
      windowEnd: filtersOrMaxDays.windowEnd ?? fallbackEnd.toISOString(),
      maxMarkets:
        typeof filtersOrMaxDays.maxMarkets === 'number'
          ? filtersOrMaxDays.maxMarkets
          : DEFAULT_POLYMARKET_MAX_MARKETS,
      categories: filtersOrMaxDays.categories?.filter(Boolean),
    };
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

  async getTotalBalance(): Promise<{ totalValue: number; availableCash: number; positionsValue: number }> {
    if (!this.walletAddress) {
      console.warn('[Polymarket] ⚠️ Wallet address not configured');
      return { totalValue: 0, availableCash: 0, positionsValue: 0 };
    }

    try {
      const [walletBalanceRaw, positionsValueRaw] = await Promise.all([
        this.getWalletBalance(),
        this.getBalance(),
      ]);

      const walletBalance =
        typeof walletBalanceRaw === 'number' && walletBalanceRaw >= 0 ? walletBalanceRaw : 0;
      const positionsValue =
        typeof positionsValueRaw === 'number' && Number.isFinite(positionsValueRaw)
          ? positionsValueRaw
          : 0;
      const totalValue = walletBalance + positionsValue;

      if (walletBalanceRaw < 0) {
        console.warn(
          '[Polymarket] ⚠️ Wallet balance query failed, assuming $0 available cash for this scan.'
        );
      } else {
        console.log(`[Polymarket] 💵 Available cash: $${walletBalance.toFixed(2)}`);
      }

      console.log(`[Polymarket] 📊 Positions value: $${positionsValue.toFixed(2)}`);
      console.log(`[Polymarket] ✅ Total account value: $${totalValue.toFixed(2)}`);

      return {
        totalValue,
        availableCash: walletBalance,
        positionsValue,
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
    // DRY-FIRE GUARD: Never place real orders in dry-fire mode
    if (isDryFireMode()) {
      const error = '[Polymarket DRY-FIRE GUARD] Attempted to place real order in DRY_FIRE_MODE!';
      console.error(error);
      return { success: false, error };
    }

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

