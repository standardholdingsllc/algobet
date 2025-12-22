/**
 * API Endpoint: GET /api/live-arb/opportunities
 *
 * Fetches arb opportunities logged by the DO worker from Upstash.
 *
 * Query Parameters:
 * - date: YYYY-MM-DD format (defaults to today)
 * - limit: Maximum number of records to return (default 100)
 * - cursor: Pagination cursor (start index)
 *
 * Response:
 * - logs: Array of ArbOpportunityLog objects
 * - total: Total count of logs for the date
 * - cursor: Next cursor for pagination (if more records exist)
 * - hasMore: Boolean indicating if more records exist
 */

import { NextApiRequest, NextApiResponse } from 'next';
import {
  getArbLogs,
  ArbOpportunityLog,
  GetArbLogsResult,
} from '@/lib/arb-opportunity-logger';

interface OpportunitiesResponse extends GetArbLogsResult {
  date: string;
  generatedAt: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OpportunitiesResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Disable caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    const { date, limit, cursor } = req.query;

    // Validate date format
    let dateStr: string | undefined;
    if (date && typeof date === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          error: 'Invalid date format. Use YYYY-MM-DD.',
        });
      }
      dateStr = date;
    }

    // Parse limit
    let limitNum: number | undefined;
    if (limit && typeof limit === 'string') {
      limitNum = parseInt(limit, 10);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
        return res.status(400).json({
          error: 'Invalid limit. Must be between 1 and 1000.',
        });
      }
    }

    // Parse cursor
    let cursorNum: number | undefined;
    if (cursor && typeof cursor === 'string') {
      cursorNum = parseInt(cursor, 10);
      if (isNaN(cursorNum) || cursorNum < 0) {
        return res.status(400).json({
          error: 'Invalid cursor. Must be a non-negative integer.',
        });
      }
    }

    // Fetch logs
    const result = await getArbLogs({
      date: dateStr,
      limit: limitNum,
      cursor: cursorNum,
    });

    const response: OpportunitiesResponse = {
      ...result,
      date: dateStr || new Date().toISOString().split('T')[0],
      generatedAt: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error: any) {
    console.error('[API] Error fetching opportunities:', error);
    res.status(500).json({
      error: 'Failed to fetch opportunities',
    });
  }
}

