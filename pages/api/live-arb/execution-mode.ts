/**
 * API: Live Arb Execution Mode
 *
 * GET  /api/live-arb/execution-mode - Get current execution mode
 * POST /api/live-arb/execution-mode - Change execution mode
 *
 * The execution mode controls whether the live arb system:
 * - 'DRY_FIRE': Detects opportunities and logs them as paper trades
 * - 'LIVE': Executes real trades
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { KVStorage, getOrSeedBotConfig } from '@/lib/kv-storage';
import { getExecutionMode, isDryFireMode } from '@/lib/execution-wrapper';
import { ExecutionMode } from '@/types';

interface ExecutionModeResponse {
  /** Effective execution mode */
  mode: ExecutionMode;
  /** Config value from KV */
  configMode?: ExecutionMode;
  /** Whether dry-fire is active (same as mode === 'DRY_FIRE') */
  isDryFire: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Preload config to ensure cache is fresh
  await getOrSeedBotConfig();

  if (req.method === 'GET') {
    try {
      const config = await getOrSeedBotConfig();
      const mode = getExecutionMode();
      
      const response: ExecutionModeResponse = {
        mode,
        configMode: config.liveExecutionMode || 'DRY_FIRE',
        isDryFire: isDryFireMode(),
      };

      return res.status(200).json(response);
    } catch (error) {
      console.error('[ExecutionMode API] Error getting execution mode:', error);
      return res.status(500).json({ error: 'Failed to get execution mode' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { mode } = req.body as { mode?: ExecutionMode };

      // Validate mode
      if (!mode || !['DRY_FIRE', 'LIVE'].includes(mode)) {
        return res.status(400).json({
          error: 'Invalid mode. Must be "DRY_FIRE" or "LIVE"',
        });
      }

      // Update config in KV
      await KVStorage.updateConfig({ liveExecutionMode: mode });

      // Get updated state
      const updatedConfig = await getOrSeedBotConfig();
      const effectiveMode = getExecutionMode();

      console.log(`[ExecutionMode API] Changed execution mode: ${mode} (effective: ${effectiveMode})`);

      return res.status(200).json({
        success: true,
        mode: effectiveMode,
        configMode: updatedConfig.liveExecutionMode,
        isDryFire: isDryFireMode(),
      });
    } catch (error) {
      console.error('[ExecutionMode API] Error setting execution mode:', error);
      return res.status(500).json({ error: 'Failed to set execution mode' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

