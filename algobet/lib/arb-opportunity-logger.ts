import { ArbitrageOpportunity } from '@/types';
import { liveArbLog } from './live-arb-logger';

export interface ArbOpportunityLogEntry {
  timestamp: string;
  opportunityId: string;
  profitMargin: number;
  profitPercentage: number;
  expectedProfit: number;
  market1: {
    platform: string;
    marketId: string;
    title: string;
    odds: number;
    betSize: number;
  };
  market2: {
    platform: string;
    marketId: string;
    title: string;
    odds: number;
    betSize: number;
  };
  metadata?: {
    matchupKey?: string;
    priceTimestampA?: string;
    priceTimestampB?: string;
    betSizes?: {
      amount1: number;
      amount2: number;
    };
  };
}

/**
 * Create an arbitrage opportunity log entry
 */
export function createArbOpportunityLog(
  opportunity: ArbitrageOpportunity,
  metadata?: {
    matchupKey?: string;
    priceTimestampA?: string;
    priceTimestampB?: string;
    betSizes?: {
      amount1: number;
      amount2: number;
    };
  }
): ArbOpportunityLogEntry {
  return {
    timestamp: new Date().toISOString(),
    opportunityId: opportunity.id,
    profitMargin: opportunity.profitMargin,
    profitPercentage: opportunity.profitPercentage,
    expectedProfit: opportunity.expectedProfit,
    market1: {
      platform: opportunity.market1.platform,
      marketId: opportunity.market1.id,
      title: opportunity.market1.title,
      odds: opportunity.market1.yesPrice,
      betSize: opportunity.betSize1,
    },
    market2: {
      platform: opportunity.market2.platform,
      marketId: opportunity.market2.id,
      title: opportunity.market2.title,
      odds: opportunity.market2.yesPrice,
      betSize: opportunity.betSize2,
    },
    metadata,
  };
}

/**
 * Log an arbitrage opportunity
 */
export async function logArbOpportunity(logEntry: ArbOpportunityLogEntry): Promise<void> {
  try {
    // Log to console for now - in production this could go to a database or file
    liveArbLog('info', 'ArbOpportunity', 'Arbitrage opportunity detected', {
      opportunityId: logEntry.opportunityId,
      profitMargin: logEntry.profitMargin.toFixed(2) + '%',
      expectedProfit: '$' + logEntry.expectedProfit.toFixed(2),
      market1: `${logEntry.market1.platform}:${logEntry.market1.title}`,
      market2: `${logEntry.market2.platform}:${logEntry.market2.title}`,
    });

    // Here you could add code to save to a database, send to external logging service, etc.
    // For example:
    // await saveToDatabase(logEntry);
    // await sendToLoggingService(logEntry);

  } catch (error) {
    liveArbLog('error', 'ArbOpportunity', 'Failed to log arbitrage opportunity', error as Error);
    throw error;
  }
}
