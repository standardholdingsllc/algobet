import { NextApiRequest, NextApiResponse } from 'next';
import { KVStorage } from '@/lib/kv-storage';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth required

  if (req.method === 'GET') {
    try {
      const bets = await KVStorage.getBets();
      // Sort by placedAt, newest first
      const sortedBets = bets.sort((a, b) => 
        new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime()
      );
      return res.status(200).json({ bets: sortedBets });
    } catch (error) {
      console.error('Error fetching bets:', error);
      return res.status(500).json({ error: 'Failed to fetch bets' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

