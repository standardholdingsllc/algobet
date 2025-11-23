import type { NextApiRequest, NextApiResponse } from 'next';
import { loadMarketSnapshotWithSource } from '@/lib/market-snapshots';
import { toLlmReadySnapshot } from '@/lib/llm-snapshots';
import {
  SNAPSHOT_PLATFORMS,
  normalizeSnapshotPlatformParam,
} from '@/lib/snapshot-platforms';

export const config = {
  api: {
    responseLimit: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const platform = normalizeSnapshotPlatformParam(req.query.platform);
  if (!platform) {
    return res.status(400).json({
      error: 'Invalid platform parameter',
      supportedPlatforms: SNAPSHOT_PLATFORMS,
    });
  }

  try {
    const { snapshot, diagnostics } = await loadMarketSnapshotWithSource(
      platform
    );

    if (!snapshot) {
      return res.status(404).json({
        error: `No snapshot available for ${platform}`,
        diagnostics: diagnostics ?? {},
      });
    }

    const llmSnapshot = toLlmReadySnapshot(snapshot);
    const payload = JSON.stringify(llmSnapshot, null, 2);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${platform}-llm-snapshot.json"`
    );
    res.setHeader('Cache-Control', 'no-store');

    return res.status(200).send(payload);
  } catch (error: any) {
    console.error('[Snapshots] Failed to load LLM snapshot:', error);
    return res.status(500).json({
      error: 'Failed to load LLM-ready snapshot',
      details: error?.message ?? 'unknown error',
    });
  }
}

