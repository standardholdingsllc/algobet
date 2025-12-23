import { NextApiRequest, NextApiResponse } from 'next';
import { getOpportunityLogs } from '@/lib/storage';
import Papa from 'papaparse';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth required for exports

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { format = 'json', startDate, endDate } = req.query;
    
    // Get all opportunity logs
    let logs = await getOpportunityLogs();
    
    // Filter by date range
    if (startDate) {
      logs = logs.filter(
        log => new Date(log.timestamp) >= new Date(startDate as string)
      );
    }
    
    if (endDate) {
      logs = logs.filter(
        log => new Date(log.timestamp) <= new Date(endDate as string)
      );
    }

    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (format === 'csv') {
      // Convert to CSV format
      const csvData = logs.map(log => ({
        'Timestamp': new Date(log.timestamp).toISOString(),
        'Event': log.eventName,
        'Platform 1': log.platform1,
        'Platform 2': log.platform2,
        'Market 1 Side': log.market1Side,
        'Market 2 Side': log.market2Side,
        'Market 1 Price': log.market1Price,
        'Market 2 Price': log.market2Price,
        'Market 1 Type': log.market1Type,
        'Market 2 Type': log.market2Type,
        'Profit Margin %': log.profitMargin.toFixed(2),
        'Estimated Profit $': log.estimatedProfit.toFixed(2),
        'Bet Size 1 $': log.betSize1.toFixed(2),
        'Bet Size 2 $': log.betSize2.toFixed(2),
        'Total Investment $': log.totalInvestment.toFixed(2),
        'Days to Expiry': log.daysToExpiry.toFixed(1),
        'Would Execute': log.withinExecutionWindow ? 'Yes' : 'No',
        'Skip Reason': log.skipReason || 'N/A',
      }));

      const csv = Papa.unparse(csvData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="opportunities-${Date.now()}.csv"`);
      return res.status(200).send(csv);
    }

    // Default to JSON
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="opportunities-${Date.now()}.json"`);
    return res.status(200).json(logs);
  } catch (error: any) {
    console.error('Error exporting opportunity logs:', error);
    return res.status(500).json({ error: error.message });
  }
}

