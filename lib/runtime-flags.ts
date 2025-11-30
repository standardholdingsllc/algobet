import { BotConfig } from '@/types';

/**
 * Resolve whether Gemini/MatchGraph-powered workflows (HotMarketTracker,
 * match graph downloads, live cross-book tracking) should execute.
 * Controlled entirely by the KV-backed BotConfig so deployments can toggle
 * the feature from the dashboard without touching environment variables.
 */
export function resolveMatchGraphEnabled(
  config?: BotConfig | null
): boolean {
  if (typeof config?.matchGraphEnabled === 'boolean') {
    return config.matchGraphEnabled;
  }
  return false;
}

