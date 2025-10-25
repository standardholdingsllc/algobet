/**
 * Adaptive scanning system
 * Scans faster during live events, slower during quiet periods
 */

export interface ScanConfig {
  defaultInterval: number;      // Normal scanning (30 seconds)
  liveEventInterval: number;    // During live games (5 seconds)
  highActivityInterval: number; // High volatility (10 seconds)
  quietInterval: number;        // No events (60 seconds)
}

export class AdaptiveScanner {
  private config: ScanConfig;
  private currentInterval: number;
  private lastScanResults: {
    opportunitiesFound: number;
    liveEventsCount: number;
    timestamp: Date;
  }[];

  constructor(config?: Partial<ScanConfig>) {
    this.config = {
      defaultInterval: 30000,        // 30 seconds
      liveEventInterval: 5000,       // 5 seconds (FAST)
      highActivityInterval: 10000,   // 10 seconds
      quietInterval: 60000,          // 60 seconds
      ...config,
    };
    this.currentInterval = this.config.defaultInterval;
    this.lastScanResults = [];
  }

  /**
   * Determine optimal scan interval based on market conditions
   * NOTE: No time-of-day logic - sports happen globally 24/7
   */
  getNextInterval(
    liveEventsCount: number,
    opportunitiesFound: number,
    recentActivity: number
  ): number {
    // PRIORITY 1: Live sports events happening NOW
    // (Soccer in Europe, Tennis in Asia, etc. - always something live globally)
    if (liveEventsCount > 0) {
      console.log(`🔴 LIVE EVENTS DETECTED (${liveEventsCount}) - Scanning every 5 seconds`);
      return this.config.liveEventInterval; // 5 seconds
    }

    // PRIORITY 2: Recent opportunities found (high volatility)
    if (opportunitiesFound > 0 || recentActivity > 3) {
      console.log(`⚡ High activity - Scanning every 10 seconds`);
      return this.config.highActivityInterval; // 10 seconds
    }

    // PRIORITY 3: No live events but markets available
    // Since sports/markets are 24/7 global, we scan at default rate
    console.log(`📊 Standard scanning - every 30 seconds`);
    return this.config.defaultInterval; // 30 seconds
  }

  /**
   * Record scan results to track activity
   */
  recordScanResult(
    opportunitiesFound: number,
    liveEventsCount: number
  ): void {
    this.lastScanResults.push({
      opportunitiesFound,
      liveEventsCount,
      timestamp: new Date(),
    });

    // Keep only last 10 scans
    if (this.lastScanResults.length > 10) {
      this.lastScanResults.shift();
    }
  }

  /**
   * Calculate recent activity level (0-10)
   */
  getRecentActivity(): number {
    const last5Scans = this.lastScanResults.slice(-5);
    return last5Scans.reduce((sum, result) => sum + result.opportunitiesFound, 0);
  }

  /**
   * Check if any live events are happening
   * (This would check sx.bet for in-progress games)
   */
  async checkForLiveEvents(): Promise<number> {
    // TODO: Implement live event detection
    // For now, return 0
    // In full implementation:
    // 1. Check sx.bet fixtures for status: 1 (live)
    // 2. Check if game started in last 3 hours
    // 3. Return count of live games
    return 0;
  }

  /**
   * Get current interval
   */
  getCurrentInterval(): number {
    return this.currentInterval;
  }

  /**
   * Update current interval
   */
  setCurrentInterval(interval: number): void {
    this.currentInterval = interval;
  }
}

/**
 * Detect live events from markets based purely on market characteristics
 * Sports happen globally 24/7 (soccer in Europe, tennis in Asia, etc.)
 * so we can't rely on time-of-day logic
 */
export function detectLiveEvents(markets: any[]): number {
  let liveCount = 0;
  const now = new Date();

  // Sports/live event keywords
  const liveKeywords = [
    'live', 'inplay', 'in play', 'in-play',
    'quarter', 'half', 'period', 'inning', 'set',
    'tonight', 'today', 'now', 'current'
  ];

  for (const market of markets) {
    const expiryTime = new Date(market.expiryDate);
    const hoursUntilExpiry = (expiryTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    // DETECTION CRITERIA:
    
    // 1. Sportsbook markets expiring within 3 hours (likely live or starting very soon)
    if (market.marketType === 'sportsbook' && hoursUntilExpiry <= 3 && hoursUntilExpiry > 0) {
      liveCount++;
      continue;
    }

    // 2. Markets with "live" keywords expiring within 6 hours
    const titleLower = market.title?.toLowerCase() || '';
    const hasLiveKeyword = liveKeywords.some(keyword => titleLower.includes(keyword));
    if (hasLiveKeyword && hoursUntilExpiry <= 6 && hoursUntilExpiry > 0) {
      liveCount++;
      continue;
    }

    // 3. Any market expiring within 1 hour (imminent resolution)
    if (hoursUntilExpiry <= 1 && hoursUntilExpiry > 0) {
      liveCount++;
      continue;
    }
  }

  return liveCount;
}

