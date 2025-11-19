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
  // Watchdog heartbeat
  watchdogLastRun?: string;
  // Restart throttling
  restartAttempts?: number;
  restartAttemptWindowStart?: string;
  lastRestartReason?: string;
  restartThrottled?: boolean;
  // Scan duration metrics
  lastScanDurationMs?: number;
  averageScanDurationMs?: number;
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
  // Watchdog heartbeat
  watchdogLastRun?: string;
  minutesSinceWatchdog?: number;
  // Restart throttling
  restartAttempts: number;
  restartThrottled: boolean;
  lastRestartReason?: string;
  // Scan duration metrics
  lastScanDurationMs?: number;
  averageScanDurationMs?: number;
  // Health reasons
  healthReasons: string[];
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

export async function updateBotHealth(success: boolean, scanDurationMs?: number): Promise<void> {
  try {
    const current = await redis.get<BotStatus>('algobet:bot:status') || {
      running: false,
      lastUpdated: new Date().toISOString(),
      consecutiveErrors: 0,
      totalScans: 0,
      totalErrors: 0,
      restartAttempts: 0
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

    // Update scan duration metrics
    if (scanDurationMs !== undefined) {
      updated.lastScanDurationMs = scanDurationMs;
      
      // Calculate simple moving average (weighted towards recent scans)
      const currentAvg = current.averageScanDurationMs || scanDurationMs;
      updated.averageScanDurationMs = Math.round((currentAvg * 0.8) + (scanDurationMs * 0.2));
    }

    await redis.set('algobet:bot:status', updated);
  } catch (error) {
    console.error('Error updating bot health:', error);
  }
}

export async function updateWatchdogHeartbeat(): Promise<void> {
  try {
    const current = await redis.get<BotStatus>('algobet:bot:status');
    if (current) {
      await redis.set('algobet:bot:status', {
        ...current,
        watchdogLastRun: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error updating watchdog heartbeat:', error);
  }
}

export async function recordRestart(reason: string, isSoftRestart: boolean = false): Promise<boolean> {
  try {
    const current = await redis.get<BotStatus>('algobet:bot:status') || {
      running: false,
      lastUpdated: new Date().toISOString(),
      consecutiveErrors: 0,
      totalScans: 0,
      totalErrors: 0,
      restartAttempts: 0
    };

    const now = Date.now();
    const windowStart = current.restartAttemptWindowStart 
      ? new Date(current.restartAttemptWindowStart).getTime() 
      : 0;
    
    // Check if we need to reset the window (60 minutes = 3600000ms)
    const windowExpired = (now - windowStart) > 3600000;
    
    let restartAttempts = windowExpired ? 0 : (current.restartAttempts || 0);
    let restartAttemptWindowStart = windowExpired ? new Date().toISOString() : current.restartAttemptWindowStart;

    // Soft restarts don't count towards throttle limit
    if (!isSoftRestart) {
      // Check throttle limit (max 3 restarts per 60 minutes)
      if (restartAttempts >= 3 && !windowExpired) {
        console.log('[Watchdog] Restart blocked: throttle limit reached (3 restarts in 60 minutes)');
        await redis.set('algobet:bot:status', {
          ...current,
          restartThrottled: true,
          lastRestartReason: `Throttled: ${reason}`
        });
        return false; // Restart blocked
      }

      restartAttempts += 1;
      if (!restartAttemptWindowStart) {
        restartAttemptWindowStart = new Date().toISOString();
      }
    }

    await redis.set('algobet:bot:status', {
      ...current,
      restartAttempts,
      restartAttemptWindowStart,
      lastRestartReason: reason,
      restartThrottled: false
    });

    return true; // Restart allowed
  } catch (error) {
    console.error('Error recording restart:', error);
    return false;
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
        totalErrors: 0,
        restartAttempts: 0,
        restartThrottled: false,
        healthReasons: ['No bot status data']
      };
    }

    const now = Date.now();
    const lastScanTime = data.lastScan ? new Date(data.lastScan).getTime() : 0;
    const minutesSinceLastScan = lastScanTime ? Math.floor((now - lastScanTime) / 60000) : undefined;

    const watchdogTime = data.watchdogLastRun ? new Date(data.watchdogLastRun).getTime() : 0;
    const minutesSinceWatchdog = watchdogTime ? Math.floor((now - watchdogTime) / 60000) : undefined;

    // Determine health reasons
    const healthReasons: string[] = [];
    let healthy = true;

    if (data.running) {
      // Check all health criteria
      if (minutesSinceLastScan !== undefined && minutesSinceLastScan >= 5) {
        healthy = false;
        healthReasons.push(`No scan in ${minutesSinceLastScan} minutes`);
      }

      if ((data.consecutiveErrors || 0) >= 5) {
        healthy = false;
        healthReasons.push(`${data.consecutiveErrors} consecutive errors`);
      }

      if (minutesSinceWatchdog !== undefined && minutesSinceWatchdog >= 10) {
        healthy = false;
        healthReasons.push(`Watchdog inactive for ${minutesSinceWatchdog} minutes`);
      }

      if (data.restartThrottled) {
        healthy = false;
        healthReasons.push('Restart throttling active');
      }

      if (healthy) {
        healthReasons.push('All systems operational');
      }
    } else {
      // Bot not running is considered "healthy" (not in error state)
      healthReasons.push('Bot is disabled');
    }

    return {
      healthy,
      running: data.running,
      lastScan: data.lastScan,
      lastSuccessfulScan: data.lastSuccessfulScan,
      minutesSinceLastScan,
      consecutiveErrors: data.consecutiveErrors || 0,
      totalScans: data.totalScans || 0,
      totalErrors: data.totalErrors || 0,
      watchdogLastRun: data.watchdogLastRun,
      minutesSinceWatchdog,
      restartAttempts: data.restartAttempts || 0,
      restartThrottled: data.restartThrottled || false,
      lastRestartReason: data.lastRestartReason,
      lastScanDurationMs: data.lastScanDurationMs,
      averageScanDurationMs: data.averageScanDurationMs,
      healthReasons
    };
  } catch (error) {
    console.error('Error getting bot health:', error);
    return {
      healthy: false,
      running: false,
      consecutiveErrors: 0,
      totalScans: 0,
      totalErrors: 0,
      restartAttempts: 0,
      restartThrottled: false,
      healthReasons: ['Error fetching health status']
    };
  }
}

