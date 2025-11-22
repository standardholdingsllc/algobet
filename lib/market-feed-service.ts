import axios from 'axios';
import {
  Market,
  MarketSnapshot,
  MarketFilterInput,
  MarketPlatform,
  MarketAdapterConfig,
  BotConfig,
  SnapshotMeta,
} from '@/types';
import { MarketSourceConfigStore } from './market-source-config';
import {
  MARKET_SNAPSHOT_SCHEMA_VERSION,
  saveMarketSnapshots,
  loadMarketSnapshotWithSource,
  loadMarketSnapshot,
  isSnapshotFresh,
  getSnapshotAgeMs,
  SnapshotSource,
  SnapshotLoadDiagnostics,
  SnapshotDiagnostic,
} from './market-snapshots';
import { KALSHI_API_BASE, MARKET_SNAPSHOT_TTL_SECONDS } from './constants';
import { PolymarketAPI } from './markets/polymarket';
import { SXBetAPI, SXBetMarketFetchStats } from './markets/sxbet';

type CanonicalFilterInput = MarketFilterInput & {
  __selfHealToken?: symbol;
};

const SELF_HEAL_TOKEN = Symbol('market-feed-service.selfHealToken');

interface AdapterResult {
  adapterId: string;
  markets: Market[];
  stats?: SnapshotMeta;
}

interface LoadOptions {
  platforms?: MarketPlatform[];
  maxAgeMs?: number;
  fallbackToLiveFetch?: boolean;
  /**
   * persistOnFallback is reserved for canonical filters that originate from
   * buildFiltersFromConfig. We stamp those filters with an internal token and
   * silently ignore persistence if the token is missing.
   */
  persistOnFallback?: boolean;
  persistMaxDaysToExpiry?: number;
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
) => Promise<AdapterHandlerResult>;

interface AdapterHandlerResult {
  markets: Market[];
  stats?: SnapshotMeta;
}

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
    const filterInput: CanonicalFilterInput = {
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
    filterInput.__selfHealToken = SELF_HEAL_TOKEN;
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

    const { markets, stats } = await handler(adapterConfig, filters);
    return { adapterId: resolvedAdapterId, markets, stats };
  }

  getSxBetFetchStats(): SXBetMarketFetchStats | null {
    return this.sxbetApi.getLastFetchStats();
  }

  async loadCachedMarkets(
    filters: MarketFilterInput,
    options: LoadOptions = {}
  ): Promise<Record<MarketPlatform, Market[]>> {
    const config = await MarketSourceConfigStore.getConfig();
    const platforms =
      options.platforms ?? (Object.keys(config) as MarketPlatform[]);
    const results: Partial<Record<MarketPlatform, Market[]>> = {};
    const fallbackSnapshots: Partial<Record<MarketPlatform, AdapterResult>> = {};

    const maxAgeMs = options.maxAgeMs ?? SNAPSHOT_DEFAULT_MAX_AGE_MS;
    const allowPersistence =
      Boolean(options.persistOnFallback) && this.hasCanonicalSelfHealToken(filters);

    if (options.persistOnFallback && !allowPersistence) {
      console.warn(
        '[MarketFeed] persistOnFallback requested with non-canonical filters; persistence disabled for this call.'
      );
    }

    for (const platform of platforms) {
      const platformConfig = config[platform];
      if (!platformConfig) {
        console.warn(
          `[MarketFeed] No MarketSourceConfig entry for ${platform}; skipping snapshot load.`
        );
        continue;
      }
      const defaultAdapterConfig =
        platformConfig.adapters[platformConfig.defaultAdapter];

      const { snapshot, source, diagnostics } =
        await loadMarketSnapshotWithSource(platform, { maxAgeMs });
      const snapshotAgeMs = snapshot ? getSnapshotAgeMs(snapshot) : null;
      const isFresh =
        snapshot && isSnapshotFresh(snapshot, maxAgeMs);
      const schemaMismatch =
        snapshot &&
        snapshot.schemaVersion !== MARKET_SNAPSHOT_SCHEMA_VERSION;
      let usableSnapshot = Boolean(snapshot && isFresh && !schemaMismatch);

      const reasonParts: string[] = [];
      if (!snapshot) {
        reasonParts.push('missing');
        const diagSummary = summarizeDiagnostics(diagnostics);
        if (diagSummary) {
          reasonParts.push(diagSummary);
        }
      } else {
        if (schemaMismatch) {
          reasonParts.push(
            `schema v${snapshot.schemaVersion} expected v${MARKET_SNAPSHOT_SCHEMA_VERSION}`
          );
        }
        if (!isFresh) {
          reasonParts.push(
            `stale (${formatDuration(snapshotAgeMs)} old, max ${formatDuration(
              maxAgeMs
            )})`
          );
        }
        const diagSummary = summarizeDiagnostics(diagnostics);
        if (diagSummary) {
          reasonParts.push(diagSummary);
        }
      }

      if (snapshot && usableSnapshot) {
        const adapterIdForSnapshot =
          snapshot.adapterId ?? platformConfig.defaultAdapter;
        const adapterConfigForSnapshot =
          platformConfig.adapters[adapterIdForSnapshot] ||
          defaultAdapterConfig;
        const suspectReason = this.getSnapshotSuspicionReason(
          platform,
          snapshot,
          adapterConfigForSnapshot
        );
        if (suspectReason) {
          usableSnapshot = false;
          reasonParts.push(suspectReason);
          console.warn(
            `[MarketFeed] Snapshot for ${platform} flagged as suspect (${suspectReason}); will fetch live data instead.`
          );
        }
      }

      if (snapshot && usableSnapshot) {
        logSnapshotHit(platform, source, snapshot, snapshotAgeMs, maxAgeMs);
        results[platform] = snapshot.markets;
        continue;
      }

      if (snapshot && !usableSnapshot && !options.fallbackToLiveFetch) {
        const reason = reasonParts.length ? reasonParts.join('; ') : 'stale';
        console.warn(
          `[MarketFeed] Snapshot for ${platform} not fresh (${reason}) but live fallback disabled; using cached snapshot anyway.`
        );
        results[platform] = snapshot.markets;
        continue;
      }

      if (options.fallbackToLiveFetch) {
        const reason =
          reasonParts.length > 0
            ? reasonParts.join('; ')
            : 'missing snapshot';
        console.warn(
          `[MarketFeed] Snapshot for ${platform} unavailable (${reason}); fetching live feed as fallback.`
        );
        try {
          const live = await this.fetchLiveMarketsForPlatform(
            platform,
            filters
          );
          results[platform] = live.markets;
          if (allowPersistence) {
            fallbackSnapshots[platform] = live;
          }
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

    if (allowPersistence) {
      const fallbackPlatforms = Object.keys(
        fallbackSnapshots
      ) as MarketPlatform[];
      if (fallbackPlatforms.length > 0) {
        const persistMaxDays =
          options.persistMaxDaysToExpiry ??
          this.getMaxDaysFromFilters(filters);
        try {
          await this.persistSnapshots(
            fallbackSnapshots,
            filters,
            persistMaxDays,
            'bot-self-heal'
          );
          console.info(
            `[MarketFeed] Persisted fallback snapshots for ${fallbackPlatforms.join(
              ', '
            )} (${fallbackPlatforms.length} total).`
          );
        } catch (error: any) {
          console.error(
            `[MarketFeed] Failed to persist fallback snapshots for ${fallbackPlatforms.join(
              ', '
            )}:`,
            error?.message || error
          );
        }
      }
    }

    return results as Record<MarketPlatform, Market[]>;
  }

  async persistSnapshots(
    payloads: Partial<Record<MarketPlatform, AdapterResult>>,
    filters: MarketFilterInput,
    maxDaysToExpiry: number,
    writer?: string
  ): Promise<Partial<Record<MarketPlatform, MarketSnapshot>>> {
    const platformMarkets: Partial<Record<MarketPlatform, Market[]>> = {};
    const perPlatformOptions: Partial<
      Record<
        MarketPlatform,
        {
          adapterId?: string;
          filters?: MarketFilterInput;
          maxDaysToExpiry?: number;
          schemaVersion?: number;
          meta?: SnapshotMeta;
        }
      >
    > = {};

    (Object.entries(payloads) as [MarketPlatform, AdapterResult][])
      .forEach(([platform, payload]) => {
        platformMarkets[platform] = payload.markets;
        let meta: SnapshotMeta | undefined;
        if (payload.stats) {
          meta = { ...payload.stats };
        }
        if (writer) {
          meta = { ...(meta ?? {}), writer };
        }
        perPlatformOptions[platform] = {
          adapterId: payload.adapterId,
          filters,
          maxDaysToExpiry,
          schemaVersion: MARKET_SNAPSHOT_SCHEMA_VERSION,
          meta,
        };
      });

    return saveMarketSnapshots(platformMarkets, {
      maxDaysToExpiry,
      filters,
      perPlatformOptions,
    });
  }

  private async handleKalshiMarkets(
    adapterConfig: MarketAdapterConfig,
    filters: MarketFilterInput
  ): Promise<AdapterHandlerResult> {
    const params = this.buildQueryParams(adapterConfig, filters);
    const pagination = adapterConfig.pagination;
    const maxMarkets =
      filters.maxMarkets ?? Number.POSITIVE_INFINITY;
    this.normalizeKalshiMarketParams(params);

    const markets = await this.fetchKalshiMarketsFromEndpoint(
      adapterConfig.endpoint,
      params,
      pagination,
      filters,
      maxMarkets
    );
    return { markets };
  }

  private async handleKalshiEvents(
    adapterConfig: MarketAdapterConfig,
    filters: MarketFilterInput
  ): Promise<AdapterHandlerResult> {
    const tickers = filters.leagueTickers || [];
    if (!tickers.length) {
      console.warn(
        '[MarketFeed] Kalshi events adapter requires leagueTickers filter.'
      );
      return { markets: [] };
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
    return { markets: aggregated };
  }

  private async handlePolymarketHybrid(
    _adapterConfig: MarketAdapterConfig,
    filters: MarketFilterInput
  ): Promise<AdapterHandlerResult> {
    const markets = await this.polymarketApi.getOpenMarkets(filters);
    return { markets: this.applyExpiryFilter(markets, filters) };
  }

  private async handleSxBetRest(
    adapterConfig: MarketAdapterConfig,
    filters: MarketFilterInput
  ): Promise<AdapterHandlerResult> {
    const maxDays = this.getMaxDaysFromFilters(filters);
    const pageSize =
      adapterConfig.pagination?.limit &&
      adapterConfig.pagination.limit > 0
        ? adapterConfig.pagination.limit
        : undefined;
    const previousSnapshot = await loadMarketSnapshot('sxbet');
    const marketsResult = await this.sxbetApi.getOpenMarkets({
      maxDaysToExpiry: maxDays,
      endpoint: adapterConfig.endpoint,
      pageSize,
      maxPages: adapterConfig.pagination?.maxPages,
      maxMarkets: filters.maxMarkets,
      staticParams: adapterConfig.staticParams,
      previousMarkets: previousSnapshot?.markets,
    });
    const sxbetStats = this.sxbetApi.getLastFetchStats();
    const meta: SnapshotMeta | undefined = sxbetStats
      ? {
          rawMarkets: sxbetStats.rawMarkets,
          withinWindow: sxbetStats.withinWindow,
          hydratedWithOdds: sxbetStats.hydratedWithOdds,
          reusedOdds: sxbetStats.reusedOdds,
          stopReason: sxbetStats.stopReason,
          pagesFetched: sxbetStats.pagesFetched,
        }
      : undefined;
    return {
      markets: this.applyExpiryFilter(marketsResult, filters),
      stats: meta,
    };
  }

  private async fetchKalshiMarketsFromEndpoint(
    endpoint: string,
    params: Record<string, any>,
    pagination: MarketAdapterConfig['pagination'],
    filters: MarketFilterInput,
    maxMarkets?: number
  ): Promise<Market[]> {
    const markets: Market[] = [];
    let cursor: string | undefined;
    let page = 0;
    const maxPagesCap = pagination?.maxPages;
    const hasMaxPagesCap =
      typeof maxPagesCap === 'number' &&
      Number.isFinite(maxPagesCap) &&
      maxPagesCap > 0;
    const hasMarketCap =
      typeof maxMarkets === 'number' && Number.isFinite(maxMarkets);
    const marketCapValue = hasMarketCap ? (maxMarkets as number) : undefined;
    let stopReason: string | null = null;

    while (true) {
      page += 1;
      const pageParams = { ...params };
      if (cursor !== undefined && pagination?.cursorParam) {
        pageParams[pagination.cursorParam] = cursor;
      }

      const requestLabel = `[Kalshi Adapter] ${endpoint} page ${page}`;
      const logParams = {
        ...pageParams,
        cursor: cursor ?? '<none>',
      };
      console.info(
        `${requestLabel} → requesting with params ${JSON.stringify(logParams)}`
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
      const normalized = this.normalizeKalshiMarkets(rawMarkets, filters);
      markets.push(...normalized);

      const nextCursor = this.extractCursor(
        response.data,
        pagination?.nextCursorPath
      );
      console.info(
        `${requestLabel} ← ${rawMarkets.length} raw (first_close=${firstClose}, last_close=${lastClose}), ${normalized.length} tradable, cursor="${nextCursor ?? ''}"`
      );

      const noMorePages = !nextCursor;
      const reachedMaxPages = hasMaxPagesCap && page >= (maxPagesCap as number);
      const reachedMarketCap =
        hasMarketCap && markets.length >= (marketCapValue as number);

      if (reachedMarketCap) {
        stopReason = `reached maxMarkets cap (${marketCapValue})`;
      } else if (reachedMaxPages) {
        stopReason = `reached maxPages cap (${maxPagesCap})`;
      } else if (noMorePages) {
        stopReason = 'pagination cursor missing/empty';
      }

      if (stopReason) {
        break;
      }

      cursor = nextCursor;
    }

    if (hasMarketCap && markets.length > (marketCapValue as number)) {
      return markets.slice(0, marketCapValue as number);
    }
    if (!stopReason) {
      stopReason = 'completed without explicit stop signal';
    }
    if (markets.length === 0) {
      console.warn(
        '[Kalshi Adapter] No markets returned after pagination ' +
          `(window ${filters.windowStart} → ${filters.windowEnd}) ` +
          `(stopped because ${stopReason})`
      );
    } else {
      console.info(
        `[Kalshi Adapter] Collected ${markets.length} tradable markets across ${page} page(s) (stopped because ${stopReason})`
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

  private hasCanonicalSelfHealToken(
    filters: MarketFilterInput
  ): filters is CanonicalFilterInput {
    return (
      (filters as CanonicalFilterInput).__selfHealToken === SELF_HEAL_TOKEN
    );
  }

  private getSnapshotSuspicionReason(
    platform: MarketPlatform,
    snapshot: MarketSnapshot,
    adapterConfig?: MarketAdapterConfig
  ): string | undefined {
    const minMarkets = adapterConfig?.minMarkets;
    if (!minMarkets || minMarkets <= 0) {
      return undefined;
    }
    const totalMarkets =
      snapshot.totalMarkets ?? snapshot.markets?.length ?? 0;
    if (totalMarkets < minMarkets) {
      return `markets=${totalMarkets} below expected minimum ${minMarkets}`;
    }
    if (
      snapshot.meta?.rawMarkets !== undefined &&
      snapshot.meta.rawMarkets < minMarkets
    ) {
      return `rawMarkets=${snapshot.meta.rawMarkets} below expected minimum ${minMarkets}`;
    }
    if (
      snapshot.meta?.withinWindow !== undefined &&
      snapshot.meta.withinWindow < minMarkets
    ) {
      return `withinWindow=${snapshot.meta.withinWindow} below expected minimum ${minMarkets}`;
    }
    if (
      snapshot.meta?.hydratedWithOdds !== undefined &&
      snapshot.meta.hydratedWithOdds < minMarkets
    ) {
      return `hydratedWithOdds=${snapshot.meta.hydratedWithOdds} below expected minimum ${minMarkets}`;
    }
    return undefined;
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

function formatDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) {
    return 'unknown';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms < 3_600_000) {
    return `${(ms / 60_000).toFixed(1)}m`;
  }
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function summarizeFilters(filters?: MarketFilterInput): string | undefined {
  if (!filters) return undefined;
  const parts: string[] = [];
  if (filters.windowStart) parts.push(`start=${filters.windowStart}`);
  if (filters.windowEnd) parts.push(`end=${filters.windowEnd}`);
  if (filters.sportsOnly !== undefined)
    parts.push(`sportsOnly=${filters.sportsOnly}`);
  if (filters.categories?.length)
    parts.push(`categories=${filters.categories.length}`);
  if (filters.eventTypes?.length)
    parts.push(`eventTypes=${filters.eventTypes.length}`);
  if (filters.leagueTickers?.length)
    parts.push(`leagueTickers=${filters.leagueTickers.length}`);
  if (typeof filters.maxMarkets === 'number')
    parts.push(`maxMarkets=${filters.maxMarkets}`);
  return parts.join(', ');
}

function summarizeDiagnostics(
  diagnostics?: SnapshotLoadDiagnostics
): string | undefined {
  if (!diagnostics) {
    return undefined;
  }
  const parts: string[] = [];
  (Object.entries(diagnostics) as [string, SnapshotDiagnostic | undefined][])
    .forEach(([source, diagnostic]) => {
      if (!diagnostic) return;
      parts.push(
        `${source}:${diagnostic.state}${
          diagnostic.reason ? ` (${diagnostic.reason})` : ''
        }`
      );
    });
  return parts.length ? `diagnostics=${parts.join(', ')}` : undefined;
}

function logSnapshotHit(
  platform: MarketPlatform,
  source: SnapshotSource | undefined,
  snapshot: MarketSnapshot,
  ageMs: number | null,
  maxAgeMs: number
): void {
  const adapterInfo = snapshot.adapterId
    ? `, adapter=${snapshot.adapterId}`
    : '';
  const filterSummary = summarizeFilters(snapshot.filters);
  const filterInfo = filterSummary ? `, filters=[${filterSummary}]` : '';
  const maxDaysInfo = snapshot.maxDaysToExpiry
    ? `, maxDaysToExpiry=${snapshot.maxDaysToExpiry}`
    : '';
  const totalMarkets =
    snapshot.totalMarkets ?? snapshot.markets?.length ?? 0;
  const metaInfo = snapshot.meta
    ? `, rawMarkets=${snapshot.meta.rawMarkets ?? 'n/a'}, withinWindow=${snapshot.meta.withinWindow ?? 'n/a'}, hydratedWithOdds=${snapshot.meta.hydratedWithOdds ?? 'n/a'}, reusedOdds=${snapshot.meta.reusedOdds ?? 'n/a'}, writer=${snapshot.meta.writer ?? 'unknown'}, stopReason=${snapshot.meta.stopReason ?? 'n/a'}`
    : '';
  console.info(
    `[MarketFeed] Using ${source ?? 'unknown'} snapshot for ${platform}: fetched ${formatDuration(
      ageMs
    )} ago (max ${formatDuration(
      maxAgeMs
    )}) at ${snapshot.fetchedAt}, schema v${
      snapshot.schemaVersion
    }, markets=${snapshot.markets.length}/${totalMarkets}${adapterInfo}${maxDaysInfo}${filterInfo}${metaInfo}`
  );
}

