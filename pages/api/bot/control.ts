import { NextApiRequest, NextApiResponse } from 'next';
import { setBotStatus } from './status';

/**
 * Bot control endpoint
 * Note: With Vercel Cron, this endpoint only enables/disables the bot
 * The actual scanning is done by /api/bot/cron which runs every minute
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth for now - secure with API key if needed

  if (req.method === 'POST') {
    const { action } = req.body;

    if (action === 'start') {
      // Enable bot - cron will handle the actual scanning
      await setBotStatus(true);
      console.log('Bot enabled - Vercel Cron will scan every minute');
      return res.status(200).json({ 
        message: 'Bot enabled - scanning every minute via cron', 
        running: true 
      });
    } else if (action === 'stop') {
      // Disable bot - cron will skip scanning
      await setBotStatus(false);
      console.log('Bot disabled - Vercel Cron will not scan');
      return res.status(200).json({ 
        message: 'Bot disabled', 
        running: false 
      });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

