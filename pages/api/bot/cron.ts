import { NextApiRequest, NextApiResponse } from 'next';
import { ArbitrageBotEngine } from '@/lib/bot';
import { getBotStatus, updateBotHealth } from './status';

/**
 * Cron endpoint that runs every minute to scan for arbitrage opportunities
 * This is triggered by Vercel Cron and performs ONE scan per invocation
 * 
 * Features:
 * - Health tracking (last scan, error count)
 * - Graceful error recovery (continues running even if scan fails)
 * - Auto-restart capability (resets error count on success)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify this is a cron job (Vercel sets this header)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET || 'default-secret';
  
  // Allow both Vercel's cron and external cron services
  const isVercelCron = authHeader === `Bearer ${cronSecret}`;
  const isExternalCron = req.headers['user-agent']?.includes('cron') || req.query.secret === cronSecret;
  
  if (!isVercelCron && !isExternalCron) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const botEnabled = await getBotStatus();
    
    if (!botEnabled) {
      // Bot is disabled, skip scanning
      return res.status(200).json({
        message: 'Bot is disabled - skipping scan',
        running: false,
        timestamp: new Date().toISOString(),
      });
    }

    // Bot is enabled - perform a single scan with error recovery
    console.log(`[${new Date().toISOString()}] Cron scan starting...`);
    
    let scanSuccess = false;
    let errorMessage = '';
    
    try {
      const bot = new ArbitrageBotEngine();
      await bot.scanOnce();
      scanSuccess = true;
      console.log(`[${new Date().toISOString()}] Cron scan completed successfully`);
    } catch (scanError: any) {
      // Log the error but don't throw - we want to continue running
      console.error(`[${new Date().toISOString()}] Scan error (will retry next cycle):`, scanError.message);
      errorMessage = scanError.message;
      scanSuccess = false;
    }

    // Update health status regardless of success/failure
    await updateBotHealth(scanSuccess);

    if (scanSuccess) {
      return res.status(200).json({
        message: 'Scan completed successfully',
        running: true,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Return 200 (not 500) so cron doesn't think the endpoint is broken
      return res.status(200).json({
        message: 'Scan failed but bot is still running',
        running: true,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error: any) {
    // Critical error (e.g., can't read bot status) - update health and return error
    console.error('Critical error in cron handler:', error);
    await updateBotHealth(false);
    
    // Still return 200 to prevent cron from stopping
    return res.status(200).json({
      message: 'Critical error but bot will retry',
      running: true,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Prevent timeout on Vercel
export const config = {
  maxDuration: 60, // 60 seconds max (enough for one scan)
};

