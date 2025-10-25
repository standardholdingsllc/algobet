import { NextApiRequest, NextApiResponse } from 'next';
import { getBotInstance } from '@/lib/bot';
import { getBotStatus } from './status';

/**
 * Cron endpoint for keeping the bot running 24/7
 * This can be called by Vercel Cron or external cron services
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
    const botRunning = getBotStatus();
    
    if (!botRunning) {
      // Bot was stopped, don't restart automatically
      return res.status(200).json({
        message: 'Bot is stopped',
        running: false,
      });
    }

    // Bot is running, trigger a scan cycle
    const bot = getBotInstance();
    
    // Log activity
    console.log(`[${new Date().toISOString()}] Cron trigger - bot active`);

    return res.status(200).json({
      message: 'Bot is active',
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
  maxDuration: 300, // 5 minutes max
};

