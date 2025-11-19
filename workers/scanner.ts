import { KalshiService } from '../services/kalshi';
import { PolymarketService } from '../services/polymarket';
import { ArbitrageService } from '../services/arbitrage';
import { sendBalanceAlert } from '../lib/email';
import { GitHubStorage } from '../lib/github-storage';
import { DataStore, AccountBalance } from '../types';
import { MARKET_SCAN_INTERVAL, BALANCE_CHECK_INTERVAL } from '../lib/constants';
import { format } from 'date-fns';

class MarketScanner {
  private kalshiService: KalshiService;
  private polymarketService: PolymarketService;
  private isRunning: boolean = false;
  private lastBalanceCheck: number = 0;
  private lastDailySummary: string = '';

  constructor() {
    this.kalshiService = new KalshiService();
    this.polymarketService = new PolymarketService();
  }

  async start() {
    console.log('🚀 Starting AlgoBet Market Scanner...');
    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.scanAndExecute();
        await this.sleep(MARKET_SCAN_INTERVAL);
      } catch (error) {
        console.error('Error in scanner loop:', error);
        await this.sleep(MARKET_SCAN_INTERVAL);
      }
    }
  }

  stop() {
    console.log('🛑 Stopping Market Scanner...');
    this.isRunning = false;
  }

  private async scanAndExecute() {
    console.log(`[${new Date().toISOString()}] Scanning markets...`);

    try {
      // Load current data store
      const dataStore = await GitHubStorage.getDataStore();

      // Check balances periodically
      if (Date.now() - this.lastBalanceCheck > BALANCE_CHECK_INTERVAL) {
        await this.checkBalances(dataStore);
        this.lastBalanceCheck = Date.now();
      }

      // Fetch markets from both platforms
      const [kalshiMarkets, polymarketMarkets] = await Promise.all([
        this.kalshiService.getMarketsByExpiry(dataStore.config.maxDaysToExpiry),
        this.polymarketService.getMarketsByExpiry(dataStore.config.maxDaysToExpiry),
      ]);

      console.log(`Found ${kalshiMarkets.length} Kalshi markets and ${polymarketMarkets.length} Polymarket markets`);

      // Detect arbitrage opportunities
      const opportunities = ArbitrageService.detectOpportunities(
        kalshiMarkets,
        polymarketMarkets
      );

      if (opportunities.length > 0) {
        console.log(`🎯 Found ${opportunities.length} arbitrage opportunities!`);

        // Update today's profit record
        const today = format(new Date(), 'yyyy-MM-dd');
        let todayProfit = dataStore.profits.find(p => p.date === today);
        
        if (!todayProfit) {
          todayProfit = {
            date: today,
            profit: 0,
          };
          dataStore.profits.push(todayProfit);
        }

        console.log(`Detected ${opportunities.length} opportunities today`);

        // Execute top opportunities
        for (const opportunity of opportunities.slice(0, 5)) {
          // Check if we already tried this opportunity recently
          const recentAttempt = dataStore.opportunities.find(
            o => o.id === opportunity.id
          );

          if (recentAttempt) {
            continue;
          }

          // Calculate max bet amount based on account balances
          const kalshiBalance = dataStore.balances.find(b => b.platform === 'kalshi')?.balance || 0;
          const polymarketBalance = dataStore.balances.find(b => b.platform === 'polymarket')?.balance || 0;

          const maxBetAmount = Math.min(
            kalshiBalance * (dataStore.config.maxBetPercentage / 100),
            polymarketBalance * (dataStore.config.maxBetPercentage / 100)
          );

          if (maxBetAmount < 10) {
            console.log('⚠️ Insufficient balance to place bets');
            continue;
          }

          console.log(`💰 Executing opportunity: ${opportunity.profitPercentage.toFixed(2)}% profit`);

          // Execute the bets
          const bets = await ArbitrageService.executeBets(
            opportunity,
            maxBetAmount,
            this.kalshiService,
            this.polymarketService
          );

          if (bets.length === 2) {
            dataStore.bets.push(...bets);
            
            // Estimate profit (actual profit determined at resolution)
            todayProfit.profit += opportunity.netProfit * maxBetAmount / 100;

            console.log(`✅ Successfully placed ${bets.length} bets for opportunity ${opportunity.id}`);
          } else {
            console.log(`❌ Failed to place bets for opportunity ${opportunity.id}`);
          }

          dataStore.opportunities.push(opportunity);
        }

        // Save updated data
        await GitHubStorage.updateDataStore(dataStore);
      } else {
        console.log('No arbitrage opportunities found');
      }

      // Send daily summary at midnight
      await this.checkDailySummary(dataStore);

    } catch (error) {
      console.error('Error in scanAndExecute:', error);
    }
  }

  private async checkBalances(dataStore: DataStore) {
    console.log('Checking account balances...');

    try {
      const [kalshiBalances, polymarketBalances] = await Promise.all([
        this.kalshiService.getTotalBalance(),
        this.polymarketService.getTotalBalance(),
      ]);

      console.log('Balance Check Results:');
      console.log('Kalshi:', JSON.stringify(kalshiBalances));
      console.log('Polymarket:', JSON.stringify(polymarketBalances));

      // Update balances in data store
      const now = new Date();
      dataStore.balances = [
        { 
          platform: 'kalshi', 
          balance: kalshiBalances.totalValue, 
          availableCash: kalshiBalances.availableCash,
          positionsValue: kalshiBalances.positionsValue,
          lastUpdated: now 
        },
        { 
          platform: 'polymarket', 
          balance: polymarketBalances.totalValue, 
          availableCash: polymarketBalances.availableCash,
          positionsValue: polymarketBalances.positionsValue,
          lastUpdated: now 
        },
      ];

      // Check for low balance alerts
      if (dataStore.config.emailAlerts.lowBalanceAlert) {
        if (kalshiBalances.totalValue < dataStore.config.balanceThresholds.kalshi) {
          await sendBalanceAlert(
            'kalshi',
            kalshiBalances.totalValue,
            dataStore.config.balanceThresholds.kalshi
          );
        }

        if (polymarketBalances.totalValue < dataStore.config.balanceThresholds.polymarket) {
          await sendBalanceAlert(
            'polymarket',
            polymarketBalances.totalValue,
            dataStore.config.balanceThresholds.polymarket
          );
        }
      }

      await GitHubStorage.updateDataStore(dataStore);
    } catch (error) {
      console.error('Error checking balances:', error);
    }
  }

  private async checkDailySummary(dataStore: DataStore) {
    const today = format(new Date(), 'yyyy-MM-dd');
    
    // Send summary once per day (at first scan after midnight)
    if (this.lastDailySummary !== today) {
      const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
      const yesterdayProfit = dataStore.profits.find(p => p.date === yesterday);

      if (yesterdayProfit) {
        // TODO: Implement daily summary email function
        console.log(`Daily summary for ${yesterday}: Profit $${yesterdayProfit.profit}`);
      }

      this.lastDailySummary = today;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the scanner
const scanner = new MarketScanner();
scanner.start().catch(console.error);

// Handle graceful shutdown
process.on('SIGINT', () => {
  scanner.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  scanner.stop();
  process.exit(0);
});

