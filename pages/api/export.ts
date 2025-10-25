import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { exportData, ExportPeriod } from '@/lib/export';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'POST') {
    try {
      const { period, format } = req.body;
      
      const { data, filename } = await exportData({
        period: period as ExportPeriod,
        format: format as 'csv' | 'json',
      });

      const contentType = format === 'json' ? 'application/json' : 'text/csv';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(data);
    } catch (error) {
      console.error('Error exporting data:', error);
      return res.status(500).json({ error: 'Failed to export data' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

