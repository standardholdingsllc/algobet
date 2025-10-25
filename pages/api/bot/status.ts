import { NextApiRequest, NextApiResponse } from 'next';

// In-memory state (in production, use Redis or similar)
let botRunning = false;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // No auth required for status check

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

