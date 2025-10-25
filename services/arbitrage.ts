import { Market, ArbitrageOpportunity, Bet } from '@/types';
import { KalshiService } from './kalshi';
import { PolymarketService } from './polymarket';
import { MIN_PROFIT_THRESHOLD } from '@/lib/constants';

export class ArbitrageService {
  static detectOpportunities(
    markets1: Market[],
    markets2: Market[]
  ): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];

    // Compare each market from platform 1 with markets from platform 2
    for (const m1 of markets1) {
      for (const m2 of markets2) {
        // Skip if same platform
        if (m1.platform === m2.platform) continue;

        // Simple matching - in production, you'd want fuzzy matching or external market IDs
        if (this.marketsMatch(m1, m2)) {
          const opportunity = this.calculateArbitrage(m1, m2);
          if (opportunity) {
            opportunities.push(opportunity);
          }
        }
      }
    }

    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  private static marketsMatch(m1: Market, m2: Market): boolean {
    // Check if markets are about the same event
    // This is simplified - in production you'd want better matching logic
    const title1 = m1.title.toLowerCase();
    const title2 = m2.title.toLowerCase();

    // Check if titles are similar and expiry dates are close (within 1 day)
    const titleSimilar = this.calculateSimilarity(title1, title2) > 0.7;
    const expiryClose = Math.abs(new Date(m1.expiryDate).getTime() - new Date(m2.expiryDate).getTime()) < 86400000;

    return titleSimilar && expiryClose;
  }

  private static calculateSimilarity(str1: string, str2: string): number {
    // Simple Jaccard similarity for now
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  private static calculateArbitrage(
    market1: Market,
    market2: Market
  ): ArbitrageOpportunity | null {
    // Check all four possible arbitrage scenarios:
    // 1. Buy Yes on market1, Buy No on market2
    // 2. Buy No on market1, Buy Yes on market2
    // 3. Buy Yes on both (if total cost < 100)
    // 4. Buy No on both (if total cost < 100)

    const scenarios = [
      { m1Side: 'yes', m2Side: 'no', m1Price: market1.yesPrice, m2Price: market2.noPrice },
      { m1Side: 'no', m2Side: 'yes', m1Price: market1.noPrice, m2Price: market2.yesPrice },
    ];

    let bestOpportunity: ArbitrageOpportunity | null = null;
    let bestProfit = 0;

    for (const scenario of scenarios) {
      const totalCost = scenario.m1Price + scenario.m2Price;
      
      if (totalCost < 100) {
        // Calculate fees
        const m1Fee = market1.platform === 'kalshi' 
          ? KalshiService.calculateFees(100, 100 - totalCost)
          : PolymarketService.calculateFees(scenario.m1Price);
        
        const m2Fee = market2.platform === 'kalshi'
          ? KalshiService.calculateFees(100, 100 - totalCost)
          : PolymarketService.calculateFees(scenario.m2Price);

        const grossProfit = 100 - totalCost;
        const netProfit = grossProfit - m1Fee - m2Fee;
        const profitPercentage = (netProfit / totalCost) * 100;

        if (profitPercentage > MIN_PROFIT_THRESHOLD && profitPercentage > bestProfit) {
          bestProfit = profitPercentage;
          bestOpportunity = {
            id: `${market1.id}-${market2.id}-${Date.now()}`,
            market1: { ...market1, yesPrice: scenario.m1Price, noPrice: scenario.m1Price },
            market2: { ...market2, yesPrice: scenario.m2Price, noPrice: scenario.m2Price },
            side1: scenario.m1Side as 'yes' | 'no',
            side2: scenario.m2Side as 'yes' | 'no',
            profitMargin: profitPercentage,
            profitPercentage,
            betSize1: totalCost / 2,
            betSize2: totalCost / 2,
            expectedProfit: netProfit,
            netProfit,
            timestamp: new Date(),
          };
        }
      }
    }

    return bestOpportunity;
  }

  static async executeBets(
    opportunity: ArbitrageOpportunity,
    maxBetAmount: number,
    kalshiService: KalshiService,
    polymarketService: PolymarketService
  ): Promise<Bet[]> {
    const bets: Bet[] = [];
    
    // Calculate bet amounts based on prices to ensure equal payout
    const totalCost = opportunity.market1.yesPrice + opportunity.market2.noPrice;
    const betAmount = Math.min(maxBetAmount, 1000); // Cap at $1000 per opportunity

    try {
      // Determine which side to bet on each market
      const m1Side = opportunity.market1.yesPrice < opportunity.market2.yesPrice ? 'yes' : 'no';
      const m2Side = m1Side === 'yes' ? 'no' : 'yes';
      const m1Price = m1Side === 'yes' ? opportunity.market1.yesPrice : opportunity.market1.noPrice;
      const m2Price = m2Side === 'yes' ? opportunity.market2.yesPrice : opportunity.market2.noPrice;

      // Place both orders simultaneously (Fill or Kill)
      const [order1, order2] = await Promise.all([
        opportunity.market1.platform === 'kalshi'
          ? kalshiService.placeOrder(opportunity.market1.ticker, m1Side, betAmount, m1Price)
          : polymarketService.placeOrder(opportunity.market1.ticker, m1Side, betAmount, m1Price),
        opportunity.market2.platform === 'kalshi'
          ? kalshiService.placeOrder(opportunity.market2.ticker, m2Side, betAmount, m2Price)
          : polymarketService.placeOrder(opportunity.market2.ticker, m2Side, betAmount, m2Price),
      ]);

      if (order1 && order2) {
        bets.push({
          id: `${opportunity.id}-bet1`,
          arbitrageGroupId: opportunity.id,
          platform: opportunity.market1.platform,
          marketId: opportunity.market1.id,
          marketTitle: opportunity.market1.title,
          ticker: opportunity.market1.ticker,
          side: m1Side,
          amount: betAmount,
          price: m1Price,
          placedAt: new Date(),
          status: 'filled',
        });

        bets.push({
          id: `${opportunity.id}-bet2`,
          arbitrageGroupId: opportunity.id,
          platform: opportunity.market2.platform,
          marketId: opportunity.market2.id,
          marketTitle: opportunity.market2.title,
          ticker: opportunity.market2.ticker,
          side: m2Side,
          amount: betAmount,
          price: m2Price,
          placedAt: new Date(),
          status: 'filled',
        });
      }
    } catch (error) {
      console.error('Error executing bets:', error);
    }

    return bets;
  }
}

