import { NextApiRequest, NextApiResponse } from 'next';
import { Redis } from '@upstash/redis';

// Initialize Upstash Redis client
// Using Vercel's KV environment variables (set by Upstash integration)
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

interface BotStatus {
  running: boolean;
  lastUpdated: string;
  lastScan?: string;
  lastSuccessfulScan?: string;
  consecutiveErrors?: number;
  totalScans?: number;
  totalErrors?: number;
}

interface BotHealth {
  healthy: boolean;
  running: boolean;
  lastScan?: string;
  lastSuccessfulScan?: string;
  minutesSinceLastScan?: number;
  consecutiveErrors: number;
  totalScans: number;
  totalErrors: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth required for status check

  if (req.method === 'GET') {
    const health = await getBotHealth();
    return res.status(200).json(health);
  }

  res.status(405).json({ error: 'Method not allowed' });
}

export async function setBotStatus(running: boolean): Promise<void> {
  try {
    const current = await redis.get<BotStatus>('algobet:bot:status');
    await redis.set('algobet:bot:status', {
      ...current,
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
    const data = await redis.get<BotStatus>('algobet:bot:status');
    return data?.running || false;
  } catch (error) {
    console.error('Error getting bot status:', error);
    return false;
  }
}

export async function updateBotHealth(success: boolean): Promise<void> {
  try {
    const current = await redis.get<BotStatus>('algobet:bot:status') || {
      running: false,
      lastUpdated: new Date().toISOString(),
      consecutiveErrors: 0,
      totalScans: 0,
      totalErrors: 0
    };

    const now = new Date().toISOString();
    const updated: BotStatus = {
      ...current,
      lastScan: now,
      totalScans: (current.totalScans || 0) + 1,
    };

    if (success) {
      updated.lastSuccessfulScan = now;
      updated.consecutiveErrors = 0;
    } else {
      updated.consecutiveErrors = (current.consecutiveErrors || 0) + 1;
      updated.totalErrors = (current.totalErrors || 0) + 1;
    }

    await redis.set('algobet:bot:status', updated);
  } catch (error) {
    console.error('Error updating bot health:', error);
  }
}

export async function getBotHealth(): Promise<BotHealth> {
  try {
    const data = await redis.get<BotStatus>('algobet:bot:status');
    
    if (!data) {
      return {
        healthy: false,
        running: false,
        consecutiveErrors: 0,
        totalScans: 0,
        totalErrors: 0
      };
    }

    const now = Date.now();
    const lastScanTime = data.lastScan ? new Date(data.lastScan).getTime() : 0;
    const minutesSinceLastScan = lastScanTime ? Math.floor((now - lastScanTime) / 60000) : undefined;

    // Bot is unhealthy if:
    // 1. It's supposed to be running but hasn't scanned in 5+ minutes
    // 2. It has 5+ consecutive errors
    const healthy = data.running ? (
      (minutesSinceLastScan === undefined || minutesSinceLastScan < 5) &&
      (data.consecutiveErrors || 0) < 5
    ) : true; // If not running, it's "healthy" (not in error state)

    return {
      healthy,
      running: data.running,
      lastScan: data.lastScan,
      lastSuccessfulScan: data.lastSuccessfulScan,
      minutesSinceLastScan,
      consecutiveErrors: data.consecutiveErrors || 0,
      totalScans: data.totalScans || 0,
      totalErrors: data.totalErrors || 0
    };
  } catch (error) {
    console.error('Error getting bot health:', error);
    return {
      healthy: false,
      running: false,
      consecutiveErrors: 0,
      totalScans: 0,
      totalErrors: 0
    };
  }
}

