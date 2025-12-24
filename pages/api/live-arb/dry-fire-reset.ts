/**
 * API Endpoint: POST /api/live-arb/dry-fire-reset
 *
 * Resets all dry-fire statistics and logs to zero.
 * This clears both the logs array and the cached stats from KV storage.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { clearDryFireLogs } from '@/lib/dry-fire-logger';

interface ResetResponse {
  success: boolean;
  message: string;
  resetAt: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResetResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    await clearDryFireLogs();

    const response: ResetResponse = {
      success: true,
      message: 'Dry-fire statistics have been reset to zero',
      resetAt: new Date().toISOString(),
    };

    console.log('[API] Dry-fire stats reset successfully');
    res.status(200).json(response);
  } catch (error: any) {
    console.error('[API] Error resetting dry-fire stats:', error);
    res.status(500).json({
      error: error.message || 'Failed to reset dry-fire stats',
    });
  }
}

