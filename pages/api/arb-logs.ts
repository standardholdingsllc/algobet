/**
 * API Endpoint: GET /api/arb-logs
 *
 * Fetches arb opportunities logged by the DO worker from Upstash.
 * Supports both JSON and CSV output formats.
 *
 * Query Parameters:
 * - date: YYYY-MM-DD format (defaults to today)
 * - limit: Maximum number of records to return (default 100, ignored for CSV)
 * - cursor: Pagination cursor (start index, ignored for CSV)
 * - format: 'json' (default) or 'csv'
 * - validOnly: 'true' to filter out incomplete records (default for JSON)
 *
 * Response (JSON):
 * - logs: Array of ArbOpportunityLog objects with validationStatus
 * - total: Total count of logs for the date (before filtering)
 * - cursor: Next cursor for pagination (if more records exist)
 * - hasMore: Boolean indicating if more records exist
 * - validationCounts: Object with completeCount, incompleteCount, warnCount, okCount
 *
 * Response (CSV):
 * - CSV file download with opportunities for the specified date
 * - Respects validOnly filter
 */

import { NextApiRequest, NextApiResponse } from 'next';
import {
  getArbLogs,
  getAllArbLogsForDate,
  exportArbLogsToCSV,
  getTodayDateString,
  ArbOpportunityLog,
  GetArbLogsResult,
  addValidationToLogs,
  filterValidLogs,
  getValidationCounts,
  ValidationCounts,
} from '@/lib/arb-opportunity-logger';

interface ArbLogsResponse extends GetArbLogsResult {
  date: string;
  generatedAt: string;
  validationCounts: ValidationCounts;
  showingValidOnly: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArbLogsResponse | string | { error: string }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Disable caching for all responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    const { date, limit, cursor, format, validOnly } = req.query;

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

    // Parse validOnly flag (defaults to true for JSON, respects param for CSV)
    const showValidOnly = validOnly === 'true' || (validOnly !== 'false' && format !== 'csv');

    // Handle CSV format
    if (format === 'csv') {
      let logs = await getAllArbLogsForDate(dateStr);
      
      // Add validation status to all logs
      logs = addValidationToLogs(logs);
      
      // Filter if validOnly is requested
      if (validOnly === 'true') {
        logs = filterValidLogs(logs);
      }
      
      const csv = exportArbLogsToCSV(logs);

      const filename = `arb-opportunities-${dateStr}${validOnly === 'true' ? '-valid' : ''}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      return res.status(200).send(csv);
    }

    // JSON format (default)

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

    // Add validation status to all logs
    let logsWithValidation = addValidationToLogs(result.logs);
    
    // Get validation counts from ALL logs before filtering
    const allLogs = await getAllArbLogsForDate(dateStr);
    const allLogsWithValidation = addValidationToLogs(allLogs);
    const validationCounts = getValidationCounts(allLogsWithValidation);

    // Filter if validOnly is requested (default true for JSON)
    if (showValidOnly) {
      logsWithValidation = filterValidLogs(logsWithValidation);
    }

    const response: ArbLogsResponse = {
      logs: logsWithValidation,
      total: result.total,
      cursor: result.cursor,
      hasMore: result.hasMore,
      date: dateStr,
      generatedAt: new Date().toISOString(),
      validationCounts,
      showingValidOnly: showValidOnly,
    };

    res.status(200).json(response);
  } catch (error: any) {
    console.error('[API] Error fetching arb logs:', error);
    res.status(500).json({
      error: 'Failed to fetch arb logs',
    });
  }
}
