import { NextApiRequest, NextApiResponse } from 'next';
import { getBotInstance } from '@/lib/bot';
import { setBotStatus } from './status';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth for now - secure with API key if needed

  if (req.method === 'POST') {
    const { action } = req.body;

    if (action === 'start') {
      const bot = getBotInstance();
      bot.start();
      setBotStatus(true);
      return res.status(200).json({ message: 'Bot started', running: true });
    } else if (action === 'stop') {
      const bot = getBotInstance();
      bot.stop();
      setBotStatus(false);
      return res.status(200).json({ message: 'Bot stopped', running: false });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

