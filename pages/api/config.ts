import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { getConfig, updateConfig } from '@/lib/storage';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      const config = await getConfig();
      return res.status(200).json({ config });
    } catch (error) {
      console.error('Error fetching config:', error);
      return res.status(500).json({ error: 'Failed to fetch config' });
    }
  }

  if (req.method === 'POST') {
    try {
      const newConfig = req.body;
      await updateConfig(newConfig);
      return res.status(200).json({ message: 'Config updated successfully' });
    } catch (error) {
      console.error('Error updating config:', error);
      return res.status(500).json({ error: 'Failed to update config' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

