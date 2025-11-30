import { BotConfig } from '@/types';

/**
 * Environment-level switch for the legacy snapshot arbitrage system.
 * Defaults to true so existing deployments keep scanning unless explicitly disabled.
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
 * Resolve whether snapshot arbitrage should run for the current process,
 * combining env flags with optional BotConfig overrides.
 */
export function resolveSnapshotArbEnabled(
  config?: BotConfig | null
): boolean {
  if (!SNAPSHOT_ARB_ENABLED) {
    return false;
  }
  if (typeof config?.snapshotArbEnabled === 'boolean') {
    return config.snapshotArbEnabled;
  }
  return SNAPSHOT_ARB_ENABLED;
}

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

