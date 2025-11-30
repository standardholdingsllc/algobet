/**
 * API: Live Arb Execution Mode
 *
 * GET  /api/live-arb/execution-mode - Get current execution mode
 * POST /api/live-arb/execution-mode - Change execution mode
 *
 * The execution mode controls whether the live arb system:
 * - 'DRY_FIRE': Detects opportunities and logs them as paper trades
 * - 'LIVE': Executes real trades (only if DRY_FIRE_MODE env is false)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { KVStorage } from '@/lib/kv-storage';
import { getExecutionMode, isDryFireMode } from '@/lib/execution-wrapper';
import { isDryFireForcedByEnv } from '@/types/dry-fire';
import { ExecutionMode } from '@/types';

interface ExecutionModeResponse {
  /** Effective execution mode */
  mode: ExecutionMode;
  /** Whether mode is locked by DRY_FIRE_MODE env */
  forcedByEnv: boolean;
  /** Raw value of DRY_FIRE_MODE env */
  envDryFireMode: boolean;
  /** Config value from KV */
  configMode?: ExecutionMode;
  /** Whether dry-fire is active (same as mode === 'DRY_FIRE') */
  isDryFire: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Preload config to ensure cache is fresh
  await KVStorage.getConfig();

  if (req.method === 'GET') {
    try {
      const config = await KVStorage.getConfig();
      const mode = getExecutionMode();
      const forcedByEnv = isDryFireForcedByEnv();
      
      const response: ExecutionModeResponse = {
        mode,
        forcedByEnv,
        envDryFireMode: process.env.DRY_FIRE_MODE === 'true',
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

      // Check if env locks us to DRY_FIRE
      if (mode === 'LIVE' && isDryFireForcedByEnv()) {
        return res.status(400).json({
          error: 'Execution mode is locked to DRY_FIRE by DRY_FIRE_MODE env. Update your worker env to allow Live.',
          forcedByEnv: true,
        });
      }

      // Update config in KV
      await KVStorage.updateConfig({ liveExecutionMode: mode });

      // Get updated state
      const updatedConfig = await KVStorage.getConfig();
      const effectiveMode = getExecutionMode();

      console.log(`[ExecutionMode API] Changed execution mode: ${mode} (effective: ${effectiveMode})`);

      return res.status(200).json({
        success: true,
        mode: effectiveMode,
        configMode: updatedConfig.liveExecutionMode,
        forcedByEnv: isDryFireForcedByEnv(),
        isDryFire: isDryFireMode(),
      });
    } catch (error) {
      console.error('[ExecutionMode API] Error setting execution mode:', error);
      return res.status(500).json({ error: 'Failed to set execution mode' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

