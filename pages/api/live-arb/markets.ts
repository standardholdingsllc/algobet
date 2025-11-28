/**
 * Live Arb Markets API
 *
 * GET /api/live-arb/markets
 *
 * Query params:
 *   - platform?: 'kalshi' | 'polymarket' | 'sxbet' - filter by platform
 *   - liveOnly?: 'true' | 'false' - only show live events
 *   - limit?: number - max markets to return (default: 50)
 *
 * Returns tracked markets with their live prices.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { LivePriceCache } from '@/lib/live-price-cache';
import { LiveArbManager } from '@/lib/live-arb-manager';
import { MarketPlatform, TrackedMarket } from '@/types';

interface LiveMarketInfo {
  id: string;
  normalizedTitle: string;
  displayTitle: string;
  isLive: boolean;
  expiryDate: string;
  platforms: {
    platform: MarketPlatform;
    marketId: string;
    yesPrice?: number;
    noPrice?: number;
    priceSource: 'live' | 'snapshot' | 'none';
    priceAgeMs?: number;
  }[];
  hasArbitrageOpportunity: boolean;
  opportunitiesFound: number;
}

interface LiveMarketsResponse {
  markets: LiveMarketInfo[];
  totalCount: number;
  filteredCount: number;
  timestamp: string;
  filters: {
    platform?: string;
    liveOnly?: boolean;
    limit: number;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LiveMarketsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse query params
    const platformFilter = req.query.platform as MarketPlatform | undefined;
    const liveOnly = req.query.liveOnly === 'true';
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));

    // Get manager status to access tracked markets
    const managerStatus = LiveArbManager.getStatus();

    // Since we can't directly access the tracker from the API,
    // we'll get prices from the cache and build market info
    const allPrices = LivePriceCache.getAllPrices();
    const allScores = LivePriceCache.getAllScores();

    // Group prices by market
    const marketPrices = new Map<string, {
      platform: MarketPlatform;
      marketId: string;
      yesPrice?: number;
      noPrice?: number;
      yesAgeMs?: number;
      noAgeMs?: number;
    }>();

    for (const price of allPrices) {
      const key = `${price.key.platform}:${price.key.marketId}`;
      
      if (!marketPrices.has(key)) {
        marketPrices.set(key, {
          platform: price.key.platform,
          marketId: price.key.marketId,
        });
      }

      const entry = marketPrices.get(key)!;
      
      if (price.key.outcomeId === 'yes' || price.key.outcomeId === 'outcome1') {
        entry.yesPrice = price.price;
        entry.yesAgeMs = price.ageMs;
      } else if (price.key.outcomeId === 'no' || price.key.outcomeId === 'outcome2') {
        entry.noPrice = price.price;
        entry.noAgeMs = price.ageMs;
      }
    }

    // Filter by platform if specified
    let filteredMarkets = Array.from(marketPrices.values());
    
    if (platformFilter) {
      filteredMarkets = filteredMarkets.filter(m => m.platform === platformFilter);
    }

    // Check for live scores to determine if market is live
    const liveFixtures = new Set(
      allScores
        .filter(s => s.gamePhase === 'live' || s.gamePhase === 'halftime')
        .map(s => s.fixtureId)
    );

    // Build market info
    const markets: LiveMarketInfo[] = filteredMarkets
      .slice(0, limit)
      .map(m => {
        const isLive = liveFixtures.has(m.marketId);
        const maxAgeMs = Math.max(m.yesAgeMs ?? 0, m.noAgeMs ?? 0);
        
        return {
          id: `${m.platform}:${m.marketId}`,
          normalizedTitle: m.marketId.substring(0, 32), // Placeholder
          displayTitle: m.marketId.substring(0, 32),    // Placeholder
          isLive,
          expiryDate: new Date(Date.now() + 86400000).toISOString(), // Placeholder
          platforms: [{
            platform: m.platform,
            marketId: m.marketId,
            yesPrice: m.yesPrice,
            noPrice: m.noPrice,
            priceSource: m.yesPrice !== undefined ? 'live' : 'none',
            priceAgeMs: maxAgeMs > 0 ? maxAgeMs : undefined,
          }],
          hasArbitrageOpportunity: false, // Would need full arb check
          opportunitiesFound: 0,
        };
      });

    // Apply live filter if requested
    const finalMarkets = liveOnly
      ? markets.filter(m => m.isLive)
      : markets;

    const response: LiveMarketsResponse = {
      markets: finalMarkets,
      totalCount: marketPrices.size,
      filteredCount: finalMarkets.length,
      timestamp: new Date().toISOString(),
      filters: {
        platform: platformFilter,
        liveOnly,
        limit,
      },
    };

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('[API] /api/live-arb/markets error:', error);
    return res.status(500).json({ error: error.message });
  }
}

