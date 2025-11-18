import { NextApiRequest, NextApiResponse } from 'next';
import { getOpportunityLogs, clearOpportunityLogs } from '@/lib/storage';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth required for GET requests (read-only)
  // Add auth here if you want to secure it

  try {
    if (req.method === 'GET') {
      // Get all opportunity logs
      const logs = await getOpportunityLogs();
      
      // Optional filters
      const { startDate, endDate, platform, minProfit } = req.query;
      
      let filteredLogs = logs;
      
      if (startDate) {
        filteredLogs = filteredLogs.filter(
          log => new Date(log.timestamp) >= new Date(startDate as string)
        );
      }
      
      if (endDate) {
        filteredLogs = filteredLogs.filter(
          log => new Date(log.timestamp) <= new Date(endDate as string)
        );
      }
      
      if (platform) {
        filteredLogs = filteredLogs.filter(
          log => log.platform1 === platform || log.platform2 === platform
        );
      }
      
      if (minProfit) {
        filteredLogs = filteredLogs.filter(
          log => log.profitMargin >= parseFloat(minProfit as string)
        );
      }
      
      return res.status(200).json(filteredLogs);
    }

    if (req.method === 'DELETE') {
      // Clear all opportunity logs
      await clearOpportunityLogs();
      return res.status(200).json({ message: 'Opportunity logs cleared' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Error handling opportunity logs:', error);
    return res.status(500).json({ error: error.message });
  }
}

