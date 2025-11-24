import type { NextApiRequest, NextApiResponse } from 'next';
import { generateMatchGraphWithGemini } from '@/lib/gemini-match-graph';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const persistParam = Array.isArray(req.query.persist)
      ? req.query.persist[0]
      : req.query.persist;
    const maxMarketsParam = Array.isArray(req.query.maxMarkets)
      ? req.query.maxMarkets[0]
      : req.query.maxMarkets;

    const persist = persistParam === 'true';
    const maxMarketsValue = maxMarketsParam ? Number(maxMarketsParam) : undefined;
    const maxMarketsPerPlatform =
      typeof maxMarketsValue === 'number' && Number.isFinite(maxMarketsValue)
        ? maxMarketsValue
        : undefined;

    const result = await generateMatchGraphWithGemini({
      persist,
      maxMarketsPerPlatform,
    });

    return res.status(200).json({
      message: persist
        ? 'Match graph generated and persisted (manual run)'
        : 'Match graph generated (manual, not persisted)',
      graph: result.graph,
      stats: {
        llmLatencyMs: result.llmLatencyMs,
        promptCharacters: result.promptCharacters,
        inputMarketCounts: result.inputMarketCounts,
        usage: result.usage,
      },
    });
  } catch (error: any) {
    console.error('[MatchGraph Preview] Generation failed:', error);
    return res.status(500).json({
      message: 'Failed to generate match graph (preview)',
      error: error?.message ?? 'Unknown error',
    });
  }
}


