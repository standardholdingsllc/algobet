import { LlmReadyMarket, LlmReadySnapshot, MarketSnapshot } from '@/types';

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

function toLlmReadyMarket(
  snapshot: MarketSnapshot,
  marketIndex: number
): LlmReadyMarket {
  const market = snapshot.markets[marketIndex];
  return {
    id: market.id,
    platform: snapshot.platform,
    type: market.marketType === 'sportsbook' ? 'sportsbook' : 'prediction',
    title: market.title,
    expiry: normalizeExpiryDate(market.expiryDate, snapshot.fetchedAt),
  };
}

export function toLlmReadySnapshot(snapshot: MarketSnapshot): LlmReadySnapshot {
  return {
    platform: snapshot.platform,
    generatedAt: new Date().toISOString(),
    totalMarkets: snapshot.markets.length,
    markets: snapshot.markets.map((_, index) =>
      toLlmReadyMarket(snapshot, index)
    ),
  };
}

