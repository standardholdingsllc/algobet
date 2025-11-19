import { NextApiRequest, NextApiResponse } from 'next';
import { getBotHealth, setBotStatus, updateBotHealth } from './status';

/**
 * Watchdog endpoint - monitors bot health and auto-restarts if needed
 * 
 * This should be called by a separate cron job (e.g., every 5 minutes)
 * to ensure the main bot cron is still running properly.
 * 
 * Auto-restart triggers:
 * - Bot hasn't scanned in 5+ minutes (when it should run every minute)
 * - Bot has 5+ consecutive errors
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify this is a cron job
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET || 'default-secret';
  
  const isVercelCron = authHeader === `Bearer ${cronSecret}`;
  const isExternalCron = req.headers['user-agent']?.includes('cron') || req.query.secret === cronSecret;
  
  if (!isVercelCron && !isExternalCron) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const health = await getBotHealth();
    
    console.log(`[Watchdog] Health check at ${new Date().toISOString()}`);
    console.log(`[Watchdog] Status:`, {
      healthy: health.healthy,
      running: health.running,
      minutesSinceLastScan: health.minutesSinceLastScan,
      consecutiveErrors: health.consecutiveErrors
    });

    // If bot is not running, no action needed
    if (!health.running) {
      return res.status(200).json({
        message: 'Bot is not running - no action needed',
        health
      });
    }

    // If bot is healthy, no action needed
    if (health.healthy) {
      return res.status(200).json({
        message: 'Bot is healthy',
        health
      });
    }

    // Bot is unhealthy - determine the issue and restart
    const issues: string[] = [];
    
    if (health.minutesSinceLastScan !== undefined && health.minutesSinceLastScan >= 5) {
      issues.push(`No scan in ${health.minutesSinceLastScan} minutes`);
    }
    
    if (health.consecutiveErrors >= 5) {
      issues.push(`${health.consecutiveErrors} consecutive errors`);
    }

    console.log(`[Watchdog] 🚨 Bot is unhealthy: ${issues.join(', ')}`);
    console.log(`[Watchdog] 🔄 Initiating auto-restart...`);

    // Perform restart by re-enabling the bot
    // This resets the health counters on next successful scan
    await setBotStatus(false);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    await setBotStatus(true);

    // Reset error counter to give it a fresh start
    await updateBotHealth(true);

    console.log(`[Watchdog] ✅ Bot restarted successfully`);

    return res.status(200).json({
      message: 'Bot was unhealthy and has been restarted',
      issues,
      health,
      action: 'restarted',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Watchdog] Error:', error);
    return res.status(500).json({
      error: 'Watchdog failed',
      message: error.message
    });
  }
}

// Prevent timeout on Vercel
export const config = {
  maxDuration: 30,
};

