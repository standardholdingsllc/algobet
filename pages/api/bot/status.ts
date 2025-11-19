import { NextApiRequest, NextApiResponse } from 'next';
import { Redis } from '@upstash/redis';

// Initialize Upstash Redis client
// Using Vercel's KV environment variables (set by Upstash integration)
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth required for status check

  if (req.method === 'GET') {
    const running = await getBotStatus();
    return res.status(200).json({ running });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

export async function setBotStatus(running: boolean): Promise<void> {
  try {
    await redis.set('algobet:bot:status', {
      running,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error setting bot status:', error);
    throw error;
  }
}

export async function getBotStatus(): Promise<boolean> {
  try {
    const data = await redis.get<{ running: boolean }>('algobet:bot:status');
    return data?.running || false;
  } catch (error) {
    console.error('Error getting bot status:', error);
    return false;
  }
}

