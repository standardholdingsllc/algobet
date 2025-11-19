import { NextApiRequest, NextApiResponse } from 'next';
import { KVStorage } from '@/lib/kv-storage';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth required

  if (req.method === 'GET') {
    try {
      const config = await KVStorage.getConfig();
      return res.status(200).json({ config });
    } catch (error) {
      console.error('Error fetching config:', error);
      return res.status(500).json({ error: 'Failed to fetch config' });
    }
  }

  if (req.method === 'POST') {
    try {
      const newConfig = req.body;
      await KVStorage.updateConfig(newConfig);
      return res.status(200).json({ message: 'Config updated successfully' });
    } catch (error) {
      console.error('Error updating config:', error);
      return res.status(500).json({ error: 'Failed to update config' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

