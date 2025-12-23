import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Health check endpoint
 * Used by monitoring services to check if the app is alive
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}
