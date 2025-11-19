import { NextApiRequest, NextApiResponse } from 'next';
import { getBotHealth, setBotStatus, recordRestart } from './status';

/**
 * Health check and auto-recovery endpoint
 * 
 * This endpoint:
 * 1. Checks if the bot is healthy
 * 2. Auto-restarts if it's unhealthy (optional via query param)
 * 3. Returns detailed health metrics
 * 
 * Can be called manually or by an external monitoring service
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const health = await getBotHealth();
    const autoRestart = req.query.autoRestart === 'true';

    // If bot is unhealthy and auto-restart is enabled
    if (!health.healthy && health.running && autoRestart) {
      console.log('🔄 Bot is unhealthy - attempting auto-restart...');
      console.log(`   - Health reasons: ${health.healthReasons.join(', ')}`);
      console.log(`   - Minutes since last scan: ${health.minutesSinceLastScan}`);
      console.log(`   - Consecutive errors: ${health.consecutiveErrors}`);
      
      // Check if restart is allowed (throttle check)
      const restartReason = `Manual restart: ${health.healthReasons[0] || 'unhealthy'}`;
      const restartAllowed = await recordRestart(restartReason, false);
      
      if (!restartAllowed) {
        console.log('⛔ Restart blocked: throttle limit reached');
        return res.status(200).json({
          ...health,
          action: 'blocked',
          message: 'Restart blocked: throttle limit reached (3 restarts in 60 minutes)'
        });
      }
      
      // Reset the bot by toggling status
      await setBotStatus(false);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      await setBotStatus(true);
      
      console.log('✅ Bot restarted successfully');
      
      return res.status(200).json({
        ...health,
        action: 'restarted',
        message: 'Bot was unhealthy and has been restarted'
      });
    }

    // Return health status
    return res.status(200).json(health);
  } catch (error: any) {
    console.error('Error in health check:', error);
    return res.status(500).json({
      error: 'Health check failed',
      message: error.message
    });
  }
}

