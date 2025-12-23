import { NextApiRequest, NextApiResponse } from 'next';
import { getAllData } from '@/lib/storage';
import { DataStore, ArbitrageOpportunity } from '@/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const data = await getAllData();
      
      // Transform data into DataStore format
      const dataStore: DataStore = {
        opportunities: [], // Convert arbitrageGroups to opportunities for backward compatibility
        bets: data.bets || [],
        balances: data.balances || [],
        profits: data.dailyStats?.map(stat => ({
          date: stat.date,
          profit: stat.totalProfit || 0,
        })) || [],
        config: data.config,
      };
      
      // If there are opportunity logs, show those as opportunities
      if (data.opportunityLogs && data.opportunityLogs.length > 0) {
        dataStore.opportunities = data.opportunityLogs.map(log => ({
          id: log.id,
          market1: {
            id: log.market1Id,
            ticker: log.market1Id,
            platform: log.platform1,
            marketType: log.market1Type,
            title: log.eventName,
            yesPrice: log.market1Price,
            noPrice: 100 - log.market1Price,
            expiryDate: log.expiryDate,
          },
          market2: {
            id: log.market2Id,
            ticker: log.market2Id,
            platform: log.platform2,
            marketType: log.market2Type,
            title: log.eventName,
            yesPrice: log.market2Price,
            noPrice: 100 - log.market2Price,
            expiryDate: log.expiryDate,
          },
          side1: log.market1Side,
          side2: log.market2Side,
          profitMargin: log.profitMargin,
          profitPercentage: log.profitMargin,
          betSize1: log.betSize1,
          betSize2: log.betSize2,
          expectedProfit: log.estimatedProfit,
          netProfit: log.estimatedProfit,
          timestamp: new Date(log.timestamp),
        }));
      }

      return res.status(200).json(dataStore);
    } catch (error) {
      console.error('Error fetching data:', error);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

