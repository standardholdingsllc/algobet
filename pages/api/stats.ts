import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { getDailyStats } from '@/lib/storage';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      const stats = await getDailyStats();
      // Sort by date
      const sortedStats = stats.sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      return res.status(200).json({ stats: sortedStats });
    } catch (error) {
      console.error('Error fetching stats:', error);
      return res.status(500).json({ error: 'Failed to fetch stats' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

