import type { NextApiRequest, NextApiResponse } from 'next';
import {
  loadLiveArbRuntimeConfig,
  updateLiveArbRuntimeConfig,
} from '@/lib/live-arb-runtime-config';
import { LiveArbRuntimeConfig } from '@/types/live-arb';

type UpdatePayload = Partial<LiveArbRuntimeConfig>;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LiveArbRuntimeConfig | { error: string }>
) {
  if (req.method === 'GET') {
    const config = await loadLiveArbRuntimeConfig();
    return res.status(200).json(config);
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    try {
      const payload = (req.body || {}) as UpdatePayload;
      const sanitized: UpdatePayload = {};

      for (const key of [
        'liveArbEnabled',
        'ruleBasedMatcherEnabled',
        'sportsOnly',
        'liveEventsOnly',
      ] as const) {
        if (typeof payload[key] === 'boolean') {
          sanitized[key] = payload[key];
        }
      }

      if (Object.keys(sanitized).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const updated = await updateLiveArbRuntimeConfig(sanitized);
      return res.status(200).json(updated);
    } catch (error: any) {
      console.error('[API] Failed to update live-arb config:', error);
      return res
        .status(500)
        .json({ error: error?.message || 'Failed to update config' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}

