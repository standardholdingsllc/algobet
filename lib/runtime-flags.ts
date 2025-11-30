import { BotConfig } from '@/types';

/**
 * @deprecated Snapshot arbitration now always runs; this flag is ignored by
 * the cron bot and is retained only for backwards compatibility with legacy
 * deployments that still set the env.
 */
export const SNAPSHOT_ARB_ENABLED =
  process.env.SNAPSHOT_ARB_ENABLED !== 'false';

/**
 * Environment-level switch for match graph + HotMarketTracker usage.
 * Defaults to false to avoid Gemini calls unless explicitly enabled.
 */
export const MATCH_GRAPH_ENABLED =
  process.env.MATCH_GRAPH_ENABLED === 'true';

/**
 * Resolve whether match-graph-enabled workflows (Gemini, HotMarketTracker)
 * should execute for the current process and config.
 */
export function resolveMatchGraphEnabled(
  config?: BotConfig | null
): boolean {
  if (!MATCH_GRAPH_ENABLED) {
    return false;
  }
  if (typeof config?.matchGraphEnabled === 'boolean') {
    return config.matchGraphEnabled;
  }
  return MATCH_GRAPH_ENABLED;
}

