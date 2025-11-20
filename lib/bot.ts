import { KalshiAPI } from './markets/kalshi';
import { PolymarketAPI } from './markets/polymarket';
import { SXBetAPI } from './markets/sxbet';
import { findArbitrageOpportunities, calculateBetSizes, validateOpportunity } from './arbitrage';
import { AdaptiveScanner, detectLiveEvents } from './adaptive-scanner';
import { HotMarketTracker } from './hot-market-tracker';
import { KVStorage } from './kv-storage';
import { sendBalanceAlert } from './email';
import { Bet, ArbitrageGroup, ArbitrageOpportunity, Market, OpportunityLog } from '@/types';
import { v4 as uuidv4 } from 'uuid';

export class ArbitrageBotEngine {
  private kalshi: KalshiAPI;
  private polymarket: PolymarketAPI;
  private sxbet: SXBetAPI;
  private scanner: AdaptiveScanner;
  private hotMarketTracker: HotMarketTracker;
  private isRunning: boolean = false;
  private isScanning: boolean = false;

  constructor() {
    this.kalshi = new KalshiAPI();
    this.polymarket = new PolymarketAPI();
    this.sxbet = new SXBetAPI();
    this.scanner = new AdaptiveScanner({
      defaultInterval: 30000,      // 30 seconds (normal)
      liveEventInterval: 5000,     // 5 seconds (LIVE EVENTS)
      highActivityInterval: 10000, // 10 seconds (high activity)
      quietInterval: 60000,        // 60 seconds (quiet)
    });
    this.hotMarketTracker = new HotMarketTracker();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Bot is already running');
      return;
    }

    this.isRunning = true;
    console.log('Arbitrage bot started');

    // Run the main loop with adaptive scanning
    while (this.isRunning) {
      try {
        // Prevent concurrent scans even in the main loop
        if (!this.isScanning) {
          this.isScanning = true;
          try {
            await this.scanAndExecute();
          } finally {
            this.isScanning = false;
          }
        } else {
          console.log('[Bot] Previous scan still running, waiting...');
        }
      } catch (error) {
        console.error('Error in bot loop:', error);
      }

      // Get next scan interval based on market conditions
      const nextInterval = this.scanner.getCurrentInterval();
      console.log(`⏱️  Next scan in ${nextInterval / 1000} seconds`);
      
      await this.sleep(nextInterval);
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log('Arbitrage bot stopped');
  }

  /**
   * Perform a single scan cycle (for cron jobs)
   * This method runs once and exits, perfect for serverless
   */
  async scanOnce(): Promise<void> {
    // Prevent concurrent scans
    if (this.isScanning) {
      console.log('[Bot] Scan already in progress, skipping...');
      return;
    }

    this.isScanning = true;
    try {
      await this.scanAndExecute();
    } finally {
      this.isScanning = false;
    }
  }

  private async scanAndExecute(): Promise<void> {
    console.log(`[${new Date().toISOString()}] Scanning for arbitrage opportunities...`);

    // Get configuration
    const config = await KVStorage.getConfig();

    // Get detailed balance information (total value, available cash, positions)
    const kalshiBalances = await this.kalshi.getTotalBalance();
    const polymarketBalances = await this.polymarket.getTotalBalance();
    const sxbetBalance = await this.sxbet.getBalance(); // sx.bet doesn't have getTotalBalance yet

    // Log balance breakdown for visibility
    console.log(`💰 Kalshi: Total $${kalshiBalances.totalValue.toFixed(2)} (Cash: $${kalshiBalances.availableCash.toFixed(2)}, Positions: $${kalshiBalances.positionsValue.toFixed(2)})`);
    console.log(`💰 Polymarket: Total $${polymarketBalances.totalValue.toFixed(2)} (Cash: $${polymarketBalances.availableCash.toFixed(2)}, Positions: $${polymarketBalances.positionsValue.toFixed(2)})`);
    console.log(`💰 SX.bet: $${sxbetBalance.toFixed(2)}`);

    // Store detailed balance information (total, cash, positions)
    await KVStorage.updateBalances([
      { 
        platform: 'kalshi', 
        balance: kalshiBalances.totalValue,
        availableCash: kalshiBalances.availableCash,
        positionsValue: kalshiBalances.positionsValue,
        lastUpdated: new Date() 
      },
      { 
        platform: 'polymarket', 
        balance: polymarketBalances.totalValue,
        availableCash: polymarketBalances.availableCash,
        positionsValue: polymarketBalances.positionsValue,
        lastUpdated: new Date() 
      },
      { 
        platform: 'sxbet', 
        balance: sxbetBalance,
        availableCash: sxbetBalance, // sx.bet doesn't track positions yet
        positionsValue: 0,
        lastUpdated: new Date() 
      },
    ]);

    // Check balance thresholds and send alerts (use total value for alerts)
    // Send emails without blocking (fire and forget to prevent timeouts)
    if (config.emailAlerts.enabled && config.emailAlerts.lowBalanceAlert) {
      if (kalshiBalances.totalValue < config.balanceThresholds.kalshi) {
        sendBalanceAlert('kalshi', kalshiBalances.totalValue, config.balanceThresholds.kalshi).catch(err => 
          console.error('Email alert failed (non-blocking):', err.message)
        );
      }
      if (polymarketBalances.totalValue < config.balanceThresholds.polymarket) {
        sendBalanceAlert('polymarket', polymarketBalances.totalValue, config.balanceThresholds.polymarket).catch(err => 
          console.error('Email alert failed (non-blocking):', err.message)
        );
      }
      if (sxbetBalance < config.balanceThresholds.sxbet) {
        sendBalanceAlert('sxbet', sxbetBalance, config.balanceThresholds.sxbet).catch(err => 
          console.error('Email alert failed (non-blocking):', err.message)
        );
      }
    }

    // Fetch open markets from all platforms
    // Note: We fetch more markets than we'll execute on to find opportunities
    // Execution is filtered by maxDaysToExpiry in executeBet()
    const [kalshiMarkets, polymarketMarkets, sxbetMarkets] = await Promise.all([
      this.kalshi.getOpenMarkets(30), // Scan up to 30 days out
      this.polymarket.getOpenMarkets(30),
      this.sxbet.getOpenMarkets(30),
    ]);

    console.log(
      `Found ${kalshiMarkets.length} Kalshi, ${polymarketMarkets.length} Polymarket, ` +
      `and ${sxbetMarkets.length} sx.bet markets`
    );

    const allMarkets = [...kalshiMarkets, ...polymarketMarkets, ...sxbetMarkets];

    // 🎯 HOT MARKET TRACKING
    // Add all markets to the tracker - it will automatically group markets that exist on multiple platforms
    this.hotMarketTracker.addMarkets(allMarkets);
    
    // Remove expired markets from tracking
    const expiredCount = this.hotMarketTracker.removeExpired();
    if (expiredCount > 0) {
      console.log(`✅ Removed ${expiredCount} expired markets from tracking`);
    }

    // Get tracking stats
    const trackingStats = this.hotMarketTracker.getStats();
    console.log(
      `🎯 Tracking ${trackingStats.totalTracked} markets across platforms ` +
      `(${trackingStats.liveTracked} live, ${trackingStats.totalPlatformCombinations} platform combinations)`
    );

    // STRATEGY 1: Check all tracked markets (priority)
    // For each market that exists on multiple platforms, check ALL platform combinations
    let trackedOpportunities: ArbitrageOpportunity[] = [];
    const trackedMarkets = this.hotMarketTracker.getAllTrackedMarkets();
    
    for (const trackedMarket of trackedMarkets) {
      const combinations = this.hotMarketTracker.getAllCombinations(trackedMarket);
      
      for (const [market1, market2] of combinations) {
        const opps = findArbitrageOpportunities(
          [market1],
          [market2],
          config.minProfitMargin
        );
        
        if (opps.length > 0) {
          console.log(
            `🔥 Found ${opps.length} arb(s) for tracked market: ${trackedMarket.displayTitle} ` +
            `(${market1.platform} vs ${market2.platform})`
          );
          trackedOpportunities.push(...opps);
        }
      }
    }

    // STRATEGY 2: General scan for new markets we haven't found yet
    const generalOpportunities = findArbitrageOpportunities(
      allMarkets,
      allMarkets,
      config.minProfitMargin
    );

    // Combine and deduplicate opportunities (tracked markets have priority)
    const allOpportunities = [...trackedOpportunities, ...generalOpportunities];
    const uniqueOpportunities = this.deduplicateOpportunities(allOpportunities);

    console.log(
      `Found ${uniqueOpportunities.length} total arbitrage opportunities ` +
      `(${trackedOpportunities.length} from tracked markets, ${generalOpportunities.length} from general scan)`
    );

    // Detect live events for adaptive scanning
    const liveEventsCount = detectLiveEvents(allMarkets);
    
    // Record scan results
    this.scanner.recordScanResult(uniqueOpportunities.length, liveEventsCount);
    
    // Calculate recent activity
    const recentActivity = this.scanner.getRecentActivity();
    
    // Determine next scan interval
    const nextInterval = this.scanner.getNextInterval(
      liveEventsCount,
      uniqueOpportunities.length,
      recentActivity
    );
    this.scanner.setCurrentInterval(nextInterval);

    // Execute the best opportunities (prioritize tracked market opportunities)
    // Use AVAILABLE CASH (not total value) for bet sizing
    for (const opportunity of uniqueOpportunities.slice(0, 5)) {
      // Limit to top 5 per scan
      try {
        await this.executeBet(
          opportunity, 
          kalshiBalances.availableCash,    // Use available cash only
          polymarketBalances.availableCash, // Use available cash only
          sxbetBalance,                     // sx.bet balance (already cash)
          config.maxBetPercentage
        );
      } catch (error) {
        console.error('Error executing bet:', error);
      }
    }
  }

  private async executeBet(
    opportunity: ArbitrageOpportunity,
    kalshiBalance: number,
    polymarketBalance: number,
    sxbetBalance: number,
    maxBetPercentage: number
  ): Promise<void> {
    // Validate opportunity is still valid
    const config = await KVStorage.getConfig();
    if (!validateOpportunity(opportunity, config.minProfitMargin)) {
      console.log('Opportunity no longer valid, skipping');
      return;
    }

    // Check if markets expire within maxDaysToExpiry
    // We scan all markets to find opportunities, but only execute on near-term events
    const now = new Date();
    const maxExpiryDate = new Date(now.getTime() + config.maxDaysToExpiry * 24 * 60 * 60 * 1000);
    
    const market1Expiry = new Date(opportunity.market1.expiryDate);
    const market2Expiry = new Date(opportunity.market2.expiryDate);
    
    const daysToExpiry1 = (market1Expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    const daysToExpiry2 = (market2Expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    const maxDays = Math.max(daysToExpiry1, daysToExpiry2);
    
    const withinExecutionWindow = market1Expiry <= maxExpiryDate && market2Expiry <= maxExpiryDate;
    
    // Get balances for the specific platforms
    const getBalance = (platform: 'kalshi' | 'polymarket' | 'sxbet') => {
      switch (platform) {
        case 'kalshi': return kalshiBalance;
        case 'polymarket': return polymarketBalance;
        case 'sxbet': return sxbetBalance;
      }
    };

    const platform1Balance = getBalance(opportunity.market1.platform);
    const platform2Balance = getBalance(opportunity.market2.platform);

    // Calculate bet sizes
    const { amount1, amount2, quantity1, quantity2 } = calculateBetSizes(
      opportunity,
      platform1Balance,
      platform2Balance,
      maxBetPercentage
    );

    // Ensure minimum bet size
    if (quantity1 < 1 || quantity2 < 1) {
      console.log('Bet size too small, skipping');
      return;
    }

    // Create opportunity log
    const opportunityLog: OpportunityLog = {
      id: uuidv4(),
      timestamp: now,
      eventName: opportunity.market1.title,
      platform1: opportunity.market1.platform,
      platform2: opportunity.market2.platform,
      market1Id: opportunity.market1.id,
      market2Id: opportunity.market2.id,
      market1Side: opportunity.side1,
      market2Side: opportunity.side2,
      market1Price: opportunity.side1 === 'yes' ? opportunity.market1.yesPrice : opportunity.market1.noPrice,
      market2Price: opportunity.side2 === 'yes' ? opportunity.market2.yesPrice : opportunity.market2.noPrice,
      market1Type: opportunity.market1.marketType,
      market2Type: opportunity.market2.marketType,
      profitMargin: opportunity.profitMargin,
      estimatedProfit: opportunity.expectedProfit,
      betSize1: amount1,
      betSize2: amount2,
      totalInvestment: amount1 + amount2,
      expiryDate: opportunity.market1.expiryDate,
      daysToExpiry: maxDays,
      withinExecutionWindow,
      skipReason: !withinExecutionWindow ? `Outside execution window (${maxDays.toFixed(1)} days)` : undefined,
    };

    // Log opportunity
    await KVStorage.addOpportunityLog(opportunityLog);

    // If in simulation mode, log and return without placing bets
    if (config.simulationMode) {
      console.log(
        `📝 SIMULATION: Logged arbitrage opportunity: ${opportunity.market1.title}`
      );
      console.log(`   Platforms: ${opportunity.market1.platform} vs ${opportunity.market2.platform}`);
      console.log(`   Profit: $${opportunity.expectedProfit.toFixed(2)} (${opportunity.profitMargin.toFixed(2)}%)`);
      console.log(`   Investment: $${(amount1 + amount2).toFixed(2)} ($${amount1.toFixed(2)} + $${amount2.toFixed(2)})`);
      console.log(`   Expires in: ${maxDays.toFixed(1)} days`);
      console.log(`   Would execute: ${withinExecutionWindow ? '✅ YES' : '⏸️  NO (outside window)'}`);
      return;
    }

    // Check if within execution window (only for actual execution)
    if (!withinExecutionWindow) {
      console.log(
        `⏸️  Skipping bet - market expires in ${maxDays.toFixed(1)} days ` +
        `(max: ${config.maxDaysToExpiry} days). ` +
        `Opportunity: ${opportunity.profitMargin.toFixed(2)}% profit`
      );
      return;
    }

    console.log(
      `Executing arbitrage: ${opportunity.market1.title}`
    );
    console.log(`Amounts: $${amount1.toFixed(2)} and $${amount2.toFixed(2)}`);
    console.log(`Expected profit: $${opportunity.expectedProfit.toFixed(2)} (${opportunity.profitMargin.toFixed(2)}%)`);

    // Place both bets simultaneously (Fill or Kill)
    const [result1, result2] = await Promise.all([
      this.placeBet(opportunity.market1, opportunity.side1, quantity1),
      this.placeBet(opportunity.market2, opportunity.side2, quantity2),
    ]);

    // Check if both succeeded
    if (result1.success && result2.success) {
      console.log('Both bets placed successfully');

      // Create bet records
      const bet1: Bet = {
        id: result1.orderId!,
        placedAt: new Date(),
        platform: opportunity.market1.platform,
        marketId: opportunity.market1.id,
        ticker: opportunity.market1.ticker,
        marketTitle: opportunity.market1.title,
        side: opportunity.side1,
        price:
          opportunity.side1 === 'yes'
            ? opportunity.market1.yesPrice
            : opportunity.market1.noPrice,
        amount: amount1,
        status: 'filled',
        arbitrageGroupId: opportunity.id,
      };

      const bet2: Bet = {
        id: result2.orderId!,
        placedAt: new Date(),
        platform: opportunity.market2.platform,
        marketId: opportunity.market2.id,
        ticker: opportunity.market2.ticker,
        marketTitle: opportunity.market2.title,
        side: opportunity.side2,
        price:
          opportunity.side2 === 'yes'
            ? opportunity.market2.yesPrice
            : opportunity.market2.noPrice,
        amount: amount2,
        status: 'filled',
        arbitrageGroupId: opportunity.id,
      };

      await Promise.all([KVStorage.addBet(bet1), KVStorage.addBet(bet2)]);

      // Create arbitrage group
      const group: ArbitrageGroup = {
        id: opportunity.id,
        createdAt: new Date(),
        bet1,
        bet2,
        expectedProfit: opportunity.expectedProfit,
        status: 'active',
      };

      await KVStorage.addArbitrageGroup(group);
    } else {
      console.error('One or both bets failed');

      // Cancel any successful bet
      if (result1.success) {
        await this.cancelBet(opportunity.market1.platform, result1.orderId!);
      }
      if (result2.success) {
        await this.cancelBet(opportunity.market2.platform, result2.orderId!);
      }
    }
  }

  private async placeBet(
    market: any,
    side: 'yes' | 'no',
    quantity: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    const price = side === 'yes' ? market.yesPrice : market.noPrice;

    if (market.platform === 'kalshi') {
      return this.kalshi.placeBet(market.ticker, side, price, quantity);
    } else if (market.platform === 'polymarket') {
      return this.polymarket.placeBet(market.id, side, price, quantity);
    } else if (market.platform === 'sxbet') {
      return this.sxbet.placeBet(market.id, side, price, quantity);
    } else {
      return { success: false, error: 'Unknown platform' };
    }
  }

  private async cancelBet(platform: string, orderId: string): Promise<void> {
    if (platform === 'kalshi') {
      await this.kalshi.cancelOrder(orderId);
    }
    // Polymarket cancellation would go here
  }

  /**
   * Deduplicate opportunities based on market IDs
   * If the same two markets appear multiple times, keep only the best opportunity
   */
  private deduplicateOpportunities(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity[] {
    const seen = new Map<string, ArbitrageOpportunity>();

    for (const opp of opportunities) {
      // Create a unique key for this market pair (order-independent)
      const markets = [
        `${opp.market1.platform}:${opp.market1.id}`,
        `${opp.market2.platform}:${opp.market2.id}`,
      ].sort();
      const key = markets.join('|');

      // Keep the opportunity with the highest profit margin
      if (!seen.has(key) || seen.get(key)!.profitMargin < opp.profitMargin) {
        seen.set(key, opp);
      }
    }

    return Array.from(seen.values()).sort((a, b) => b.profitMargin - a.profitMargin);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let botInstance: ArbitrageBotEngine | null = null;

export function getBotInstance(): ArbitrageBotEngine {
  if (!botInstance) {
    botInstance = new ArbitrageBotEngine();
  }
  return botInstance;
}

