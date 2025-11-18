import { NextApiRequest, NextApiResponse } from 'next';
import { getBotStatus } from './bot/status';

/**
 * Health check endpoint
 * Used by monitoring services to check if the app is alive
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const botRunning = getBotStatus();
  
  return res.status(200).json({
    status: 'ok',
    botRunning,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}

