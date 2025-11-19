import { NextApiRequest, NextApiResponse } from 'next';
import { KalshiAPI } from '@/lib/markets/kalshi';
import { PolymarketAPI } from '@/lib/markets/polymarket';
import { SXBetAPI } from '@/lib/markets/sxbet';
import { KVStorage } from '@/lib/kv-storage';

/**
 * Refresh balances endpoint
 * Fetches fresh balance data from all platforms and updates storage
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Refreshing balances...');

    // Initialize API clients
    const kalshi = new KalshiAPI();
    const polymarket = new PolymarketAPI();
    const sxbet = new SXBetAPI();

    // Fetch balances from all platforms
    const [kalshiBalances, polymarketBalances, sxbetBalance] = await Promise.all([
      kalshi.getTotalBalance(),
      polymarket.getTotalBalance(),
      sxbet.getBalance(),
    ]);

    // Log the results
    console.log('💰 Kalshi:', {
      total: kalshiBalances.totalValue,
      cash: kalshiBalances.availableCash,
      positions: kalshiBalances.positionsValue,
    });
    console.log('💰 Polymarket:', {
      total: polymarketBalances.totalValue,
      cash: polymarketBalances.availableCash,
      positions: polymarketBalances.positionsValue,
    });
    console.log('💰 SxBet:', sxbetBalance);

    // Update storage
    const now = new Date();
    const balances = [
      {
        platform: 'kalshi' as const,
        balance: kalshiBalances.totalValue,
        availableCash: kalshiBalances.availableCash,
        positionsValue: kalshiBalances.positionsValue,
        lastUpdated: now,
      },
      {
        platform: 'polymarket' as const,
        balance: polymarketBalances.totalValue,
        availableCash: polymarketBalances.availableCash,
        positionsValue: polymarketBalances.positionsValue,
        lastUpdated: now,
      },
      {
        platform: 'sxbet' as const,
        balance: sxbetBalance,
        availableCash: sxbetBalance,
        positionsValue: 0,
        lastUpdated: now,
      },
    ];

    await KVStorage.updateBalances(balances);

    console.log('✅ Balances refreshed successfully');

    return res.status(200).json({
      success: true,
      balances,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('❌ Error refreshing balances:', error);
    return res.status(500).json({
      error: 'Failed to refresh balances',
      message: error.message,
    });
  }
}

// Allow up to 30 seconds for balance refresh
export const config = {
  maxDuration: 30,
};

