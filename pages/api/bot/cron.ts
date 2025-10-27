import { NextApiRequest, NextApiResponse } from 'next';
import { ArbitrageBotEngine } from '@/lib/bot';
import { getBotStatus } from './status';

/**
 * Cron endpoint that runs every minute to scan for arbitrage opportunities
 * This is triggered by Vercel Cron and performs ONE scan per invocation
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

    // Bot is enabled - perform a single scan
    console.log(`[${new Date().toISOString()}] Cron scan starting...`);
    
    const bot = new ArbitrageBotEngine();
    await bot.scanOnce();
    
    console.log(`[${new Date().toISOString()}] Cron scan completed`);

    return res.status(200).json({
      message: 'Scan completed successfully',
      running: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in cron handler:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

// Prevent timeout on Vercel
export const config = {
  maxDuration: 60, // 60 seconds max (enough for one scan)
};

