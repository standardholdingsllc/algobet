import type { NextApiRequest, NextApiResponse } from 'next';
import { MarketPlatform } from '@/types';
import {
  getSnapshotAgeMs,
  loadMarketSnapshotWithSource,
} from '@/lib/market-snapshots';

const PLATFORMS: MarketPlatform[] = ['kalshi', 'polymarket', 'sxbet'];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const maxAgeMsParam = Array.isArray(req.query.maxAgeMs)
    ? req.query.maxAgeMs[0]
    : req.query.maxAgeMs;
  const maxAgeMs = maxAgeMsParam ? Number(maxAgeMsParam) : undefined;

  const snapshots = await Promise.all(
    PLATFORMS.map(async (platform) => {
      const { snapshot, source, diagnostics } =
        await loadMarketSnapshotWithSource(platform, {
          maxAgeMs,
        });
      return {
        platform,
        hasSnapshot: Boolean(snapshot),
        source: source ?? null,
        schemaVersion: snapshot?.schemaVersion ?? null,
        fetchedAt: snapshot?.fetchedAt ?? null,
        totalMarkets: snapshot?.totalMarkets ?? snapshot?.markets?.length ?? null,
        adapterId: snapshot?.adapterId ?? null,
        filters: snapshot?.filters ?? null,
        ageMs: snapshot ? getSnapshotAgeMs(snapshot) : null,
        diagnostics: diagnostics ?? {},
        stats: snapshot?.meta
          ? {
              rawMarkets: snapshot.meta.rawMarkets ?? null,
              withinWindow: snapshot.meta.withinWindow ?? null,
              hydratedWithOdds: snapshot.meta.hydratedWithOdds ?? null,
              reusedOdds: snapshot.meta.reusedOdds ?? null,
              stopReason: snapshot.meta.stopReason ?? null,
              pagesFetched: snapshot.meta.pagesFetched ?? null,
              writer: snapshot.meta.writer ?? null,
            }
          : null,
      };
    })
  );

  res.status(200).json({
    maxAgeMs: Number.isFinite(maxAgeMs ?? NaN) ? maxAgeMs : null,
    snapshots,
  });
}

