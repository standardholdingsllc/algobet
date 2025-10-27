import { NextApiRequest, NextApiResponse } from 'next';
import { GitHubStorage } from '@/lib/github-storage';

const storage = new GitHubStorage();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth required for status check

  if (req.method === 'GET') {
    const running = await getBotStatus();
    return res.status(200).json({ running });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

export async function setBotStatus(running: boolean): Promise<void> {
  try {
    const data = await storage.readData('data/bot-status.json');
    data.running = running;
    data.lastUpdated = new Date().toISOString();
    await storage.writeData('data/bot-status.json', data, `Update bot status: ${running ? 'enabled' : 'disabled'}`);
  } catch (error) {
    // If file doesn't exist, create it
    await storage.writeData('data/bot-status.json', {
      running,
      lastUpdated: new Date().toISOString()
    }, `Initialize bot status: ${running ? 'enabled' : 'disabled'}`);
  }
}

export async function getBotStatus(): Promise<boolean> {
  try {
    const data = await storage.readData('data/bot-status.json');
    return data.running || false;
  } catch (error) {
    // If file doesn't exist, default to false
    return false;
  }
}

