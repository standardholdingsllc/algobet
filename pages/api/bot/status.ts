import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

// In-memory state (in production, use Redis or similar)
let botRunning = false;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ running: botRunning });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

export function setBotStatus(running: boolean) {
  botRunning = running;
}

export function getBotStatus() {
  return botRunning;
}

