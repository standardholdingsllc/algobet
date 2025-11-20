import { Redis } from '@upstash/redis';
import {
  MarketSourceConfig,
  MarketPlatform,
  MarketAdapterConfig,
  PlatformSourceConfig,
} from '@/types';

const MARKET_SOURCE_CONFIG_KEY = 'algobet:market-source-config';

const defaultKalshiAdapters: Record<string, MarketAdapterConfig> = {
  'rest-default': {
    id: 'rest-default',
    name: 'Kalshi Markets API',
    adapterType: 'kalshi:markets',
    endpoint: '/markets',
    description:
      'Generic Kalshi markets feed using documented close_time_start/close_time_end filters.',
    staticParams: {
      status: 'open',
      sort_by: 'close_time',
      sort_dir: 'asc',
      limit: 200,
    },
    filterBindings: {
      windowStart: {
        param: 'close_time_start',
        strategy: 'direct',
        format: 'unixMilliseconds',
        extraParams: ['close_time_after'],
      },
      windowEnd: {
        param: 'close_time_end',
        strategy: 'direct',
        format: 'unixMilliseconds',
        extraParams: ['close_time_before'],
      },
      sportsOnly: {
        param: 'category',
        strategy: 'boolean',
        trueValue: 'sports',
        omitIfFalse: true,
      },
      categories: {
        param: 'category',
        strategy: 'csv',
        joinWith: ',',
      },
      eventTypes: {
        param: 'event_type',
        strategy: 'csv',
        joinWith: ',',
      },
    },
    pagination: {
      cursorParam: 'cursor',
      nextCursorPath: 'meta.next_cursor',
      maxPages: 8,
      limitParam: 'limit',
      limit: 200,
    },
    notes:
      'See https://docs.kalshi.com/welcome for filter names. Ensures far-dated contracts are filtered server-side.',
  },
  'sports-leagues': {
    id: 'sports-leagues',
    name: 'Kalshi League Events',
    adapterType: 'kalshi:events',
    endpoint: '/events/{ticker}/markets',
    description:
      'Targets specific league/event tickers via Kalshi event endpoints for richer sports metadata.',
    staticParams: {
      status: 'open',
    },
    filterBindings: {
      leagueTickers: {
        param: 'ticker',
        strategy: 'repeat',
      },
      windowStart: {
        param: 'close_time_start',
        strategy: 'direct',
        format: 'unixMilliseconds',
        extraParams: ['close_time_after'],
      },
      windowEnd: {
        param: 'close_time_end',
        strategy: 'direct',
        format: 'unixMilliseconds',
        extraParams: ['close_time_before'],
      },
    },
    notes:
      'Uses Kalshi league endpoints; requires leagueTickers filter to be provided by UI/config.',
  },
};

const DEFAULT_MARKET_SOURCE_CONFIG: MarketSourceConfig = {
  kalshi: {
    platform: 'kalshi',
    docUrl: 'https://docs.kalshi.com/welcome',
    defaultAdapter: 'rest-default',
    supportedFilters: [
      'windowStart',
      'windowEnd',
      'sportsOnly',
      'categories',
      'eventTypes',
      'leagueTickers',
      'maxMarkets',
    ],
    adapters: defaultKalshiAdapters,
  },
  polymarket: {
    platform: 'polymarket',
    docUrl: 'https://docs.polymarket.com/developers',
    defaultAdapter: 'hybrid-clob',
    supportedFilters: ['windowStart', 'windowEnd', 'categories', 'maxMarkets'],
    adapters: {
      'gamma-default': {
        id: 'gamma-default',
        name: 'Polymarket Gamma Markets',
        adapterType: 'polymarket:gamma',
        endpoint: '/markets',
        description:
          'Primary Gamma feed honoring active/closed/archived flags per docs.',
        staticParams: {
          active: 'true',
          closed: 'false',
          archived: 'false',
        },
        filterBindings: {
          categories: {
            param: 'category',
            strategy: 'csv',
            joinWith: ',',
          },
        },
        pagination: {
          limitParam: 'limit',
          limit: 500,
          maxPages: 6,
        },
      },
      'hybrid-clob': {
        id: 'hybrid-clob',
        name: 'Polymarket Hybrid (CLOB fallback)',
        adapterType: 'polymarket:hybrid',
        endpoint: '/markets',
        description:
          'Utilizes existing hybrid CLOB/Gamma client for backwards compatibility.',
        staticParams: {},
      },
    },
  },
  sxbet: {
    platform: 'sxbet',
    docUrl: 'https://api.docs.sx.bet',
    defaultAdapter: 'rest-active',
    supportedFilters: ['windowStart', 'windowEnd', 'categories'],
    adapters: {
      'rest-active': {
        id: 'rest-active',
        name: 'SX.bet Active Markets',
        adapterType: 'sxbet:rest',
        endpoint: '/markets/active',
        description:
          'REST feed for SX.bet markets filtered by USDC base token; odds resolved via /orders/odds/best.',
        staticParams: {
          baseToken: '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B',
        },
      },
    },
  },
};

const redisClient =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      })
    : null;

let cachedConfig: MarketSourceConfig | null = null;

function mergePlatformConfig(
  defaults: PlatformSourceConfig,
  overrides?: Partial<PlatformSourceConfig>
): PlatformSourceConfig {
  if (!overrides) {
    return { ...defaults, adapters: { ...defaults.adapters } };
  }

  const mergedAdapters: Record<string, MarketAdapterConfig> = {
    ...defaults.adapters,
    ...(overrides.adapters || {}),
  };

  return {
    ...defaults,
    ...overrides,
    adapters: mergedAdapters,
  };
}

function mergeMarketSourceConfig(
  overrides?: Partial<MarketSourceConfig>
): MarketSourceConfig {
  const merged: Partial<MarketSourceConfig> = {};

  const defaultPlatforms = Object.keys(
    DEFAULT_MARKET_SOURCE_CONFIG
  ) as MarketPlatform[];
  const overridePlatforms = overrides
    ? (Object.keys(overrides) as MarketPlatform[])
    : [];
  const platforms = new Set<MarketPlatform>([
    ...defaultPlatforms,
    ...overridePlatforms,
  ]);

  platforms.forEach((platform) => {
    const defaults = DEFAULT_MARKET_SOURCE_CONFIG[platform];
    const override = overrides?.[platform];
    if (defaults) {
      merged[platform] = mergePlatformConfig(defaults, override);
    } else if (override) {
      merged[platform] = override as PlatformSourceConfig;
    }
  });

  return merged as MarketSourceConfig;
}

export class MarketSourceConfigStore {
  static async getConfig(forceRefresh: boolean = false): Promise<MarketSourceConfig> {
    if (!forceRefresh && cachedConfig) {
      return cachedConfig;
    }

    try {
      const remoteConfig =
        (await redisClient?.get<MarketSourceConfig>(MARKET_SOURCE_CONFIG_KEY)) || undefined;
      cachedConfig = mergeMarketSourceConfig(remoteConfig);
    } catch (error: any) {
      console.warn(
        '[MarketSourceConfig] Failed to load config from Upstash:',
        error?.message || error
      );
      cachedConfig = mergeMarketSourceConfig();
    }

    return cachedConfig;
  }

  static async updateConfig(
    overrides: Partial<MarketSourceConfig>
  ): Promise<MarketSourceConfig> {
    const merged = mergeMarketSourceConfig(overrides);
    try {
      await redisClient?.set(MARKET_SOURCE_CONFIG_KEY, merged);
      cachedConfig = merged;
    } catch (error: any) {
      console.warn(
        '[MarketSourceConfig] Failed to persist overrides:',
        error?.message || error
      );
    }
    return merged;
  }
}

