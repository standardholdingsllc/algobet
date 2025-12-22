/**
 * API Endpoint: GET /api/live-arb/opportunities-csv
 *
 * Exports arb opportunities as a downloadable CSV file.
 *
 * Query Parameters:
 * - date: YYYY-MM-DD format (defaults to today)
 *
 * Response:
 * - CSV file download with all opportunities for the specified date
 * - Headers-only CSV if no opportunities exist (no errors)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import {
  getAllArbLogsForDate,
  exportArbLogsToCSV,
  getTodayDateString,
} from '@/lib/arb-opportunity-logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { date } = req.query;

    // Validate date format
    let dateStr: string;
    if (date && typeof date === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          error: 'Invalid date format. Use YYYY-MM-DD.',
        });
      }
      dateStr = date;
    } else {
      dateStr = getTodayDateString();
    }

    // Fetch all logs for the date
    const logs = await getAllArbLogsForDate(dateStr);

    // Convert to CSV
    const csv = exportArbLogsToCSV(logs);

    // Set headers for file download
    const filename = `arb-opportunities-${dateStr}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    res.status(200).send(csv);
  } catch (error: any) {
    console.error('[API] Error exporting opportunities CSV:', error);
    res.status(500).json({
      error: 'Failed to export opportunities',
      details: error.message,
    });
  }
}

