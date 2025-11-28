/**
 * API Endpoint: GET /api/live-arb/dry-fire-export
 *
 * Exports dry-fire trade logs as CSV.
 *
 * Query Parameters:
 * - since: ISO timestamp to filter logs from
 * - platform: Filter by specific platform
 * - status: Filter by status (SIMULATED, REJECTED_BY_SAFETY, etc.)
 * - limit: Maximum number of logs to export
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getDryFireLogs, exportDryFireLogsToCSV } from '@/lib/dry-fire-logger';
import { DryFireTradeStatus } from '@/types/dry-fire';
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
    const { since, platform, status, limit } = req.query;

    // Parse parameters
    let sinceDate: Date | undefined;
    if (since && typeof since === 'string') {
      sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({ error: 'Invalid since parameter' });
      }
    }

    let platformFilter: MarketPlatform | undefined;
    if (platform && typeof platform === 'string') {
      if (!['kalshi', 'polymarket', 'sxbet'].includes(platform)) {
        return res.status(400).json({ error: 'Invalid platform parameter' });
      }
      platformFilter = platform as MarketPlatform;
    }

    let statusFilter: DryFireTradeStatus | undefined;
    if (status && typeof status === 'string') {
      const validStatuses = ['SIMULATED', 'REJECTED_BY_SAFETY', 'REJECTED_BY_RISK', 'REJECTED_BY_VALIDATION'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status parameter' });
      }
      statusFilter = status as DryFireTradeStatus;
    }

    let limitNum: number | undefined;
    if (limit && typeof limit === 'string') {
      limitNum = parseInt(limit, 10);
      if (isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ error: 'Invalid limit parameter' });
      }
    }

    // Get logs
    const logs = await getDryFireLogs({
      since: sinceDate,
      platform: platformFilter,
      status: statusFilter,
      limit: limitNum,
    });

    // Convert to CSV
    const csv = exportDryFireLogsToCSV(logs);

    // Set headers for file download
    const filename = `dry-fire-trades-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.status(200).send(csv);
  } catch (error: any) {
    console.error('[API] Error exporting dry-fire logs:', error);
    res.status(500).json({
      error: 'Failed to export dry-fire logs',
      details: error.message,
    });
  }
}

