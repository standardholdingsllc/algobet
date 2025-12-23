/**
 * API Endpoint: GET /api/live-arb/dry-fire-stats
 *
 * Returns aggregated statistics for dry-fire (paper trading) mode.
 * Supports filtering by time range and platform.
 *
 * Query Parameters:
 * - since: ISO timestamp to filter logs from
 * - platform: Filter by specific platform (kalshi, polymarket, sxbet)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getDryFireStats, getDryFireLogs, isDryFireModeActive } from '@/lib/dry-fire-logger';
import { DryFireStats } from '@/types/dry-fire';
import { MarketPlatform } from '@/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { since, platform } = req.query;

    // Parse since parameter
    let sinceDate: Date | undefined;
    if (since && typeof since === 'string') {
      sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({ error: 'Invalid since parameter' });
      }
    }

    // Validate platform parameter
    let platformFilter: MarketPlatform | undefined;
    if (platform && typeof platform === 'string') {
      if (!['kalshi', 'polymarket', 'sxbet'].includes(platform)) {
        return res.status(400).json({ error: 'Invalid platform parameter' });
      }
      platformFilter = platform as MarketPlatform;
    }

    // Get stats
    const stats = await getDryFireStats(sinceDate);

    // If platform filter, adjust the stats (simplified)
    if (platformFilter) {
      const filteredLogs = await getDryFireLogs({
        since: sinceDate,
        platform: platformFilter,
      });

      // Recalculate for this platform
      const platformStats: Partial<DryFireStats> = {
        dryFireModeEnabled: isDryFireModeActive(),
        totalSimulated: filteredLogs.filter(l => l.status === 'SIMULATED').length,
        totalRejectedBySafety: filteredLogs.filter(l => l.status === 'REJECTED_BY_SAFETY').length,
        totalRejectedByRisk: filteredLogs.filter(l => l.status === 'REJECTED_BY_RISK').length,
        totalRejectedByValidation: filteredLogs.filter(l => l.status === 'REJECTED_BY_VALIDATION').length,
        totalPotentialProfitUsd: filteredLogs
          .filter(l => l.status === 'SIMULATED')
          .reduce((sum, l) => sum + l.expectedProfitUsd, 0),
        generatedAt: new Date().toISOString(),
        since: sinceDate?.toISOString(),
      };

      return res.status(200).json({
        ...platformStats,
        filterApplied: { platform: platformFilter },
      });
    }

    res.status(200).json(stats);
  } catch (error: any) {
    console.error('[API] Error fetching dry-fire stats:', error);
    res.status(500).json({
      error: 'Failed to fetch dry-fire stats',
      details: error.message,
    });
  }
}

