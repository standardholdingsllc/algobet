import { NextApiRequest, NextApiResponse } from 'next';
import { getBotHealth, setBotStatus, updateBotHealth, updateWatchdogHeartbeat, recordRestart } from './status';

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
    // Update watchdog heartbeat
    await updateWatchdogHeartbeat();
    
    const health = await getBotHealth();
    
    console.log(`[Watchdog] Health check at ${new Date().toISOString()}`);
    console.log(`[Watchdog] Status:`, {
      healthy: health.healthy,
      running: health.running,
      minutesSinceLastScan: health.minutesSinceLastScan,
      consecutiveErrors: health.consecutiveErrors,
      restartAttempts: health.restartAttempts,
      restartThrottled: health.restartThrottled
    });

    // If bot is not running, no action needed
    if (!health.running) {
      return res.status(200).json({
        message: 'Bot is not running - no action needed',
        health
      });
    }

    // Check for soft restart condition (2 missed scans)
    if (health.minutesSinceLastScan !== undefined && health.minutesSinceLastScan >= 2 && health.minutesSinceLastScan < 5) {
      console.log(`[Watchdog] ⚠️ Soft restart: ${health.minutesSinceLastScan} missed scan cycles`);
      
      // Record soft restart (doesn't count towards throttle)
      const restartAllowed = await recordRestart(`Soft restart: ${health.minutesSinceLastScan} missed scan cycles`, true);
      
      if (restartAllowed) {
        // Perform soft restart
        await setBotStatus(false);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        await setBotStatus(true);
        
        console.log(`[Watchdog] ✅ Soft restart completed`);
        
        return res.status(200).json({
          message: 'Soft restart performed',
          reason: `${health.minutesSinceLastScan} missed scan cycles`,
          action: 'soft_restart',
          health,
          timestamp: new Date().toISOString()
        });
      }
    }

    // If bot is healthy, no action needed
    if (health.healthy) {
      return res.status(200).json({
        message: 'Bot is healthy',
        health
      });
    }

    // Bot is unhealthy - determine the issue and attempt full restart
    const issues: string[] = [];
    let restartReason = '';
    
    if (health.minutesSinceLastScan !== undefined && health.minutesSinceLastScan >= 5) {
      const issue = `No scan in ${health.minutesSinceLastScan} minutes`;
      issues.push(issue);
      restartReason = issue;
    }
    
    if (health.consecutiveErrors >= 5) {
      const issue = `${health.consecutiveErrors} consecutive errors`;
      issues.push(issue);
      if (!restartReason) restartReason = issue;
    }

    if (health.minutesSinceWatchdog !== undefined && health.minutesSinceWatchdog >= 10) {
      const issue = `Watchdog inactive for ${health.minutesSinceWatchdog} minutes`;
      issues.push(issue);
      if (!restartReason) restartReason = issue;
    }

    console.log(`[Watchdog] 🚨 Bot is unhealthy: ${issues.join(', ')}`);

    // Check if restart is throttled
    if (health.restartThrottled) {
      console.log(`[Watchdog] ⛔ Restart blocked: throttle limit reached`);
      return res.status(200).json({
        message: 'Restart blocked due to throttle limit',
        issues,
        health,
        action: 'blocked',
        timestamp: new Date().toISOString()
      });
    }

    // Attempt full restart with throttle check
    const restartAllowed = await recordRestart(`Restart triggered: ${restartReason}`, false);

    if (!restartAllowed) {
      console.log(`[Watchdog] ⛔ Restart blocked: throttle limit reached (3 restarts in 60 minutes)`);
      return res.status(200).json({
        message: 'Restart blocked: throttle limit reached (3 restarts in 60 minutes)',
        issues,
        health,
        action: 'throttled',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[Watchdog] 🔄 Initiating full restart...`);
    console.log(`[Watchdog] Reason: ${restartReason}`);

    // Perform full restart
    await setBotStatus(false);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    await setBotStatus(true);

    // Reset error counter to give it a fresh start
    await updateBotHealth(true);

    console.log(`[Watchdog] ✅ Bot restarted successfully`);

    return res.status(200).json({
      message: 'Bot was unhealthy and has been restarted',
      reason: restartReason,
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

