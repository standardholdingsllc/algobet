import type { NextApiRequest, NextApiResponse } from 'next';
import { MarketPlatform } from '@/types';
import { loadMarketSnapshotWithSource } from '@/lib/market-snapshots';

const SUPPORTED_PLATFORMS: MarketPlatform[] = ['kalshi', 'polymarket', 'sxbet'];

function normalizePlatformParam(value: string | string[] | undefined): MarketPlatform | null {
  if (!value) {
    return null;
  }
  const normalized = (Array.isArray(value) ? value[0] : value).toLowerCase();
  return SUPPORTED_PLATFORMS.includes(normalized as MarketPlatform)
    ? (normalized as MarketPlatform)
    : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const platform = normalizePlatformParam(req.query.platform);
  if (!platform) {
    return res.status(400).json({
      error: 'Invalid platform parameter',
      supportedPlatforms: SUPPORTED_PLATFORMS,
    });
  }

  try {
    const { snapshot, diagnostics } = await loadMarketSnapshotWithSource(platform);

    if (!snapshot) {
      return res.status(404).json({
        error: `No snapshot available for ${platform}`,
        diagnostics: diagnostics ?? {},
      });
    }

    const payload = JSON.stringify(snapshot, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${platform}-snapshot.json"`
    );
    return res.status(200).send(payload);
  } catch (error: any) {
    console.error('[Snapshots] Failed to load raw snapshot:', error);
    return res.status(500).json({
      error: 'Failed to load snapshot',
      details: error?.message ?? 'unknown error',
    });
  }
}


