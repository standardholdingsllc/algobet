import axios from 'axios';
import {
  Market,
  MarketFilterInput,
  MarketPlatform,
  MarketAdapterConfig,
  BotConfig,
} from '@/types';
import { MarketSourceConfigStore } from './market-source-config';
import {
  MARKET_SNAPSHOT_SCHEMA_VERSION,
  saveMarketSnapshots,
  loadMarketSnapshot,
  isSnapshotFresh,
} from './market-snapshots';
import { KALSHI_API_BASE, MARKET_SNAPSHOT_TTL_SECONDS } from './constants';
import { PolymarketAPI } from './markets/polymarket';
import { SXBetAPI } from './markets/sxbet';

interface AdapterResult {
  adapterId: string;
  markets: Market[];
}

interface LoadOptions {
  platforms?: MarketPlatform[];
  maxAgeMs?: number;
  fallbackToLiveFetch?: boolean;
}

interface KalshiMarket {
  ticker: string;
  title: string;
  yes_bid?: number | null;
  yes_ask?: number | null;
  no_bid?: number | null;
  no_ask?: number | null;
  last_price?: number | null;
  volume: number;
  event_ticker: string;
  close_time: string;
  series_ticker?: string;
}

const DAY_MS = 86_400_000;
const SNAPSHOT_DEFAULT_MAX_AGE_MS = MARKET_SNAPSHOT_TTL_SECONDS * 1000;

type AdapterHandler = (
  adapterConfig: MarketAdapterConfig,
  filters: MarketFilterInput
) => Promise<Market[]>;

export class MarketFeedService {
  private polymarketApi = new PolymarketAPI();
  private sxbetApi = new SXBetAPI();

  private adapterHandlers: Record<string, AdapterHandler> = {
    'kalshi:markets': this.handleKalshiMarkets.bind(this),
    'kalshi:events': this.handleKalshiEvents.bind(this),
    'polymarket:gamma': this.handlePolymarketHybrid.bind(this),
    'polymarket:hybrid': this.handlePolymarketHybrid.bind(this),
    'sxbet:rest': this.handleSxBetRest.bind(this),
  };

  buildFiltersFromConfig(config: BotConfig): MarketFilterInput {
    const now = new Date();
    const maxDate = new Date(now.getTime() + config.maxDaysToExpiry * DAY_MS);
    const preferences = config.marketFilters || {};
    const filterInput: MarketFilterInput = {
      windowStart: now.toISOString(),
      windowEnd: maxDate.toISOString(),
      sportsOnly: preferences.sportsOnly,
      categories: preferences.categories?.filter(Boolean),
      eventTypes: preferences.eventTypes?.filter(Boolean),
      leagueTickers: preferences.leagueTickers?.filter(Boolean),
    };
    if (typeof preferences.maxMarkets === 'number') {
      filterInput.maxMarkets = preferences.maxMarkets;
    }
    return filterInput;
  }

  async fetchLiveMarketsForPlatforms(
    filters: MarketFilterInput,
    platforms?: MarketPlatform[]
  ): Promise<Record<MarketPlatform, AdapterResult>> {
    const config = await MarketSourceConfigStore.getConfig();
    const targets =
      platforms ?? (Object.keys(config) as MarketPlatform[]);
    const entries = await Promise.all(
      targets.map(async (platform) => {
        const result = await this.fetchLiveMarketsForPlatform(
          platform,
          filters
        );
        return [platform, result] as const;
      })
    );

    return Object.fromEntries(entries) as Record<
      MarketPlatform,
      AdapterResult
    >;
  }

  async fetchLiveMarketsForPlatform(
    platform: MarketPlatform,
    filters: MarketFilterInput,
    adapterId?: string
  ): Promise<AdapterResult> {
    const config = await MarketSourceConfigStore.getConfig();
    const platformConfig = config[platform];
    if (!platformConfig) {
      throw new Error(`No MarketSourceConfig entry for platform ${platform}`);
    }

    const resolvedAdapterId = adapterId || platformConfig.defaultAdapter;
    const adapterConfig = platformConfig.adapters[resolvedAdapterId];
    if (!adapterConfig) {
      throw new Error(
        `Adapter ${resolvedAdapterId} missing for platform ${platform}`
      );
    }
    const handler = this.adapterHandlers[adapterConfig.adapterType];
    if (!handler) {
      throw new Error(
        `No handler registered for adapterType ${adapterConfig.adapterType}`
      );
    }

    const markets = await handler(adapterConfig, filters);
    return { adapterId: resolvedAdapterId, markets };
  }

  async loadCachedMarkets(
    filters: MarketFilterInput,
    options: LoadOptions = {}
  ): Promise<Record<MarketPlatform, Market[]>> {
    const config = await MarketSourceConfigStore.getConfig();
    const platforms =
      options.platforms ?? (Object.keys(config) as MarketPlatform[]);
    const results: Partial<Record<MarketPlatform, Market[]>> = {};

    for (const platform of platforms) {
      const snapshot = await loadMarketSnapshot(platform);
      const isFresh =
        snapshot &&
        isSnapshotFresh(
          snapshot,
          options.maxAgeMs ?? SNAPSHOT_DEFAULT_MAX_AGE_MS
        );

      if (snapshot && isFresh) {
        results[platform] = snapshot.markets;
        continue;
      }

      if (options.fallbackToLiveFetch) {
        console.warn(
          `[MarketFeed] Snapshot for ${platform} missing or stale. Fetching live feed as fallback.`
        );
        try {
          const live = await this.fetchLiveMarketsForPlatform(
            platform,
            filters
          );
          results[platform] = live.markets;
        } catch (error: any) {
          console.error(
            `[MarketFeed] Failed live fallback for ${platform}:`,
            error?.message || error
          );
          results[platform] = snapshot?.markets ?? [];
        }
      } else {
        results[platform] = snapshot?.markets ?? [];
      }
    }

    return results as Record<MarketPlatform, Market[]>;
  }

  async persistSnapshots(
    payloads: Record<MarketPlatform, AdapterResult>,
    filters: MarketFilterInput,
    maxDaysToExpiry: number
  ): Promise<void> {
    const platformMarkets: Record<string, Market[]> = {};
    const perPlatformOptions: Record<
      MarketPlatform,
      {
        adapterId?: string;
        filters?: MarketFilterInput;
        maxDaysToExpiry?: number;
        schemaVersion?: number;
      }
    > = {} as any;

    (Object.entries(payloads) as [MarketPlatform, AdapterResult][])
      .forEach(([platform, payload]) => {
        platformMarkets[platform] = payload.markets;
        perPlatformOptions[platform] = {
          adapterId: payload.adapterId,
          filters,
          maxDaysToExpiry,
          schemaVersion: MARKET_SNAPSHOT_SCHEMA_VERSION,
        };
      });

    await saveMarketSnapshots(platformMarkets, {
      maxDaysToExpiry,
      filters,
      perPlatformOptions,
    });
  }

  private async handleKalshiMarkets(
    adapterConfig: MarketAdapterConfig,
    filters: MarketFilterInput
  ): Promise<Market[]> {
    const params = this.buildQueryParams(adapterConfig, filters);
    const pagination = adapterConfig.pagination;
    const maxMarkets =
      filters.maxMarkets ?? Number.POSITIVE_INFINITY;
    this.normalizeKalshiMarketParams(params);

    return this.fetchKalshiMarketsFromEndpoint(
      adapterConfig.endpoint,
      params,
      pagination,
      filters,
      maxMarkets
    );
  }

  private async handleKalshiEvents(
    adapterConfig: MarketAdapterConfig,
    filters: MarketFilterInput
  ): Promise<Market[]> {
    const tickers = filters.leagueTickers || [];
    if (!tickers.length) {
      console.warn(
        '[MarketFeed] Kalshi events adapter requires leagueTickers filter.'
      );
      return [];
    }

    const aggregated: Market[] = [];
    for (const ticker of tickers) {
      const endpoint = adapterConfig.endpoint.replace('{ticker}', ticker);
      const params = this.buildQueryParams(adapterConfig, filters);
      delete (params as Record<string, any>).ticker;
      const markets = await this.fetchKalshiMarketsFromEndpoint(
        endpoint,
        params,
        adapterConfig.pagination,
        filters,
        filters.maxMarkets
      );
      aggregated.push(...markets);
    }
    return aggregated;
  }

  private async handlePolymarketHybrid(
    _adapterConfig: MarketAdapterConfig,
    filters: MarketFilterInput
  ): Promise<Market[]> {
    const maxDays = this.getMaxDaysFromFilters(filters);
    const markets = await this.polymarketApi.getOpenMarkets(maxDays);
    return this.applyExpiryFilter(markets, filters);
  }

  private async handleSxBetRest(
    _adapterConfig: MarketAdapterConfig,
    filters: MarketFilterInput
  ): Promise<Market[]> {
    const maxDays = this.getMaxDaysFromFilters(filters);
    const markets = await this.sxbetApi.getOpenMarkets(maxDays);
    return this.applyExpiryFilter(markets, filters);
  }

  private async fetchKalshiMarketsFromEndpoint(
    endpoint: string,
    params: Record<string, any>,
    pagination: MarketAdapterConfig['pagination'],
    filters: MarketFilterInput,
    maxMarkets?: number
  ): Promise<Market[]> {
    const markets: Market[] = [];
    let cursor: string | null = null;
    let page = 0;
    const maxPages =
      pagination?.maxPages ?? Number.POSITIVE_INFINITY;

    while (true) {
      page += 1;
      const pageParams = { ...params };
      if (cursor && pagination?.cursorParam) {
        pageParams[pagination.cursorParam] = cursor;
      }

      const requestLabel = `[Kalshi Adapter] ${endpoint} page ${page}`;
      const logParams = {
        ...pageParams,
        cursor: cursor ?? null,
      };
      console.info(
        `${requestLabel} → requesting with params`,
        JSON.stringify(logParams)
      );

      const response = await axios.get(`${KALSHI_API_BASE}${endpoint}`, {
        params: pageParams,
      });
      const rawMarkets: KalshiMarket[] =
        response.data?.markets ?? response.data?.data ?? [];
      const firstClose = rawMarkets[0]?.close_time ?? null;
      const lastClose =
        rawMarkets.length > 0
          ? rawMarkets[rawMarkets.length - 1]?.close_time ?? null
          : null;
      console.info(
        `${requestLabel} ← received ${rawMarkets.length} markets (first_close=${firstClose}, last_close=${lastClose})`
      );

      const normalized = this.normalizeKalshiMarkets(rawMarkets, filters);
      markets.push(...normalized);

      const nextCursor = this.extractCursor(
        response.data,
        pagination?.nextCursorPath
      );
      console.info(
        `${requestLabel} → next_cursor=${nextCursor ?? '<null>'}`
      );

      const reachedMaxPages = page >= maxPages;
      const reachedMarketCap =
        Number.isFinite(maxMarkets) && markets.length >= (maxMarkets as number);

      if (!nextCursor || reachedMaxPages || reachedMarketCap) {
        break;
      }

      cursor = nextCursor;
    }

    if (maxMarkets && markets.length > maxMarkets) {
      return markets.slice(0, maxMarkets);
    }
    if (markets.length === 0) {
      console.warn(
        '[Kalshi Adapter] No markets returned after pagination ' +
          `(window ${filters.windowStart} → ${filters.windowEnd})`
      );
    } else {
      console.info(
        `[Kalshi Adapter] Collected ${markets.length} tradable markets across ${page} page(s)`
      );
    }
    return markets;
  }

  private buildQueryParams(
    adapterConfig: MarketAdapterConfig,
    filters: MarketFilterInput
  ): Record<string, string | number | boolean> {
    const params: Record<string, string | number | boolean> = {
      ...(adapterConfig.staticParams || {}),
    };

    if (
      adapterConfig.pagination?.limitParam &&
      adapterConfig.pagination.limit
    ) {
      params[adapterConfig.pagination.limitParam] =
        adapterConfig.pagination.limit;
    }

    const bindings = adapterConfig.filterBindings || {};
    for (const [token, binding] of Object.entries(bindings)) {
      const value = (filters as any)[token];
      if (value === undefined || value === null) {
        continue;
      }

      switch (binding.strategy ?? 'direct') {
        case 'boolean':
          if (value) {
            params[binding.param] = binding.trueValue ?? true;
          } else if (binding.falseValue !== undefined) {
            params[binding.param] = binding.falseValue;
          } else if (!binding.omitIfFalse) {
            params[binding.param] = false;
          }
          break;
        case 'csv':
          if (Array.isArray(value) && value.length) {
            params[binding.param] = value.join(binding.joinWith ?? ',');
          }
          break;
        case 'direct':
        default:
          params[binding.param] = this.formatFilterValue(
            value,
            binding.format
          );
          if (binding.extraParams?.length) {
            const formatted = params[binding.param];
            for (const extra of binding.extraParams) {
              params[extra] = formatted;
            }
          }
      }
    }

    return params;
  }

  private formatFilterValue(
    value: unknown,
    format?: string
  ): string | number | boolean {
    if (format === 'iso8601') {
      const date = new Date(value as string);
      return Number.isNaN(date.getTime()) ? (value as string) : date.toISOString();
    }
    if (format === 'unixSeconds') {
      const date = new Date(value as string);
      if (Number.isNaN(date.getTime())) {
        return value as string | number | boolean;
      }
      return Math.floor(date.getTime() / 1000);
    }
    return value as string | number | boolean;
  }

  private normalizeKalshiMarketParams(
    params: Record<string, string | number | boolean>
  ): void {
    const timestampFamilies: Record<
      'created' | 'close' | 'settled',
      string[]
    > = {
      created: ['min_created_ts', 'max_created_ts'],
      close: ['min_close_ts', 'max_close_ts'],
      settled: ['min_settled_ts', 'max_settled_ts'],
    };

    const activeFamilies = Object.entries(timestampFamilies)
      .filter(([, keys]) => keys.some((key) => params[key] !== undefined))
      .map(([family]) => family as 'created' | 'close' | 'settled');

    if (activeFamilies.length > 1) {
      const [kept, ...dropped] = activeFamilies;
      console.warn(
        `[Kalshi Adapter] Multiple timestamp families provided (${activeFamilies.join(
          ', '
        )}); keeping ${kept} and dropping ${dropped.join(', ')} per API contract.`
      );
      for (const family of dropped) {
        for (const key of timestampFamilies[family]) {
          delete params[key];
        }
      }
    }

    const family = activeFamilies[0] ?? 'none';
    const status = params.status as string | undefined;
    const allowedStatuses: Record<
      'none' | 'created' | 'close' | 'settled',
      (string | undefined)[]
    > = {
      none: [],
      created: ['unopened', 'open', undefined],
      close: ['closed', undefined],
      settled: ['settled', undefined],
    };

    if (
      status &&
      allowedStatuses[family as 'created' | 'close' | 'settled' | 'none'].length &&
      !allowedStatuses[
        family as 'created' | 'close' | 'settled' | 'none'
      ].includes(status)
    ) {
      console.warn(
        `[Kalshi Adapter] Removing incompatible status=${status} for ${family} timestamp filters`
      );
      delete params.status;
    }

    if (params.limit !== undefined) {
      const limit = Number(params.limit);
      if (!Number.isNaN(limit)) {
        params.limit = Math.min(Math.max(Math.floor(limit), 1), 1000);
      } else {
        delete params.limit;
      }
    }
  }

  private extractCursor(payload: any, path?: string): string | undefined {
    if (!path) {
      return (
        payload?.meta?.next_cursor ??
        payload?.next_cursor ??
        payload?.cursor ??
        undefined
      );
    }

    const segments = path.split('.');
    let current = payload;
    for (const segment of segments) {
      if (!current) return undefined;
      current = current[segment];
    }
    return typeof current === 'string' ? current : undefined;
  }

  private normalizeKalshiMarkets(
    entries: KalshiMarket[],
    _filters: MarketFilterInput
  ): Market[] {
    const normalized: Market[] = [];
    let skippedInvalidClose = 0;
    let skippedMissingPrices = 0;

    for (const market of entries) {
      const closeTime = new Date(market.close_time);
      if (Number.isNaN(closeTime.getTime())) {
        skippedInvalidClose += 1;
        continue;
      }
      const { yesPrice, noPrice } = this.deriveKalshiPrices(market);
      if (yesPrice == null || noPrice == null) {
        skippedMissingPrices += 1;
        continue;
      }

      normalized.push({
        id: market.ticker,
        ticker: market.ticker,
        platform: 'kalshi',
        marketType: 'prediction',
        title: market.title,
        yesPrice,
        noPrice,
        expiryDate: closeTime.toISOString(),
        volume: market.volume,
      });
    }

    normalized.sort(
      (a, b) =>
        new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
    );

    console.info(
      `[Kalshi Adapter] Normalized ${entries.length} raw markets into ${normalized.length} tradable entries ` +
        `(skipped ${skippedInvalidClose} by invalid close_time, ${skippedMissingPrices} by missing prices)`
    );

    return normalized;
  }

  private deriveKalshiPrices(
    market: KalshiMarket
  ): { yesPrice: number | null; noPrice: number | null } {
    const normalize = (value?: number | null) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : null;

    const yesBid = normalize(market.yes_bid);
    const yesAsk = normalize(market.yes_ask);
    const noBid = normalize(market.no_bid);
    const noAsk = normalize(market.no_ask);
    const lastPrice = normalize(market.last_price);

    const derivedYes =
      yesAsk ??
      (noBid != null ? 100 - noBid : null) ??
      yesBid ??
      lastPrice;

    const derivedNo =
      noAsk ??
      (yesBid != null ? 100 - yesBid : null) ??
      noBid ??
      (derivedYes != null ? 100 - derivedYes : null);

    return {
      yesPrice: derivedYes,
      noPrice: derivedNo,
    };
  }

  private applyExpiryFilter(
    markets: Market[],
    filters: MarketFilterInput
  ): Market[] {
    const startMs = Date.parse(filters.windowStart);
    const endMs = Date.parse(filters.windowEnd);
    return markets.filter((market) => {
      const expiry = Date.parse(market.expiryDate);
      if (Number.isNaN(expiry)) {
        return false;
      }
      if (!Number.isNaN(startMs) && expiry < startMs) {
        return false;
      }
      if (!Number.isNaN(endMs) && expiry > endMs) {
        return false;
      }
      return true;
    });
  }

  private getMaxDaysFromFilters(filters: MarketFilterInput): number {
    const start = Date.parse(filters.windowStart);
    const end = Date.parse(filters.windowEnd);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      return 5;
    }
    return Math.max(1, Math.ceil((end - start) / DAY_MS));
  }
}

