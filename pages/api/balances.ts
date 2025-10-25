import { NextApiRequest, NextApiResponse } from 'next';
import { getBalances } from '@/lib/storage';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth required

  if (req.method === 'GET') {
    try {
      const balances = await getBalances();
      return res.status(200).json({ balances });
    } catch (error) {
      console.error('Error fetching balances:', error);
      return res.status(500).json({ error: 'Failed to fetch balances' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

