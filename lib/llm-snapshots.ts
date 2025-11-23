import {
  LlmReadyMarket,
  LlmReadySnapshot,
  Market,
  MarketSnapshot,
} from '@/types';

const KALSHI_MULTI_GAME_PREFIX = 'KXMVESPORTSMULTIGAMEEXTENDED';

function normalizeExpiryDate(
  value: string | undefined,
  fallback: string
): string {
  if (!value) {
    return fallback;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toISOString();
}

function shouldIncludeInLlmSnapshot(
  snapshot: MarketSnapshot,
  market: Market
): boolean {
  if (snapshot.platform === 'kalshi') {
    if (market.ticker?.startsWith(KALSHI_MULTI_GAME_PREFIX)) {
      return false;
    }
  }
  return true;
}

function toLlmReadyMarket(
  snapshot: MarketSnapshot,
  market: Market
): LlmReadyMarket {
  return {
    id: market.id,
    platform: snapshot.platform,
    type: market.marketType === 'sportsbook' ? 'sportsbook' : 'prediction',
    title: market.title,
    expiry: normalizeExpiryDate(market.expiryDate, snapshot.fetchedAt),
  };
}

export function toLlmReadySnapshot(snapshot: MarketSnapshot): LlmReadySnapshot {
  const filteredMarkets = snapshot.markets.filter((market) =>
    shouldIncludeInLlmSnapshot(snapshot, market)
  );

  return {
    platform: snapshot.platform,
    generatedAt: new Date().toISOString(),
    totalMarkets: filteredMarkets.length,
    markets: filteredMarkets.map((market) =>
      toLlmReadyMarket(snapshot, market)
    ),
  };
}

