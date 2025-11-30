import {
  LiveEventMatcherConfig,
  DEFAULT_LIVE_EVENT_MATCHER_CONFIG,
} from '@/types/live-events';
import { getCachedLiveArbRuntimeConfig } from './live-arb-runtime-config';

const ENV_MATCHER_OVERRIDES = {
  timeTolerance: parseInt(process.env.LIVE_MATCH_TIME_TOLERANCE_MS || '900000', 10),
  minTeamSimilarity: parseFloat(process.env.LIVE_MIN_TEAM_SIMILARITY || '0.7'),
  maxWatchers: parseInt(process.env.LIVE_MAX_EVENT_WATCHERS || '50', 10),
  minPlatforms: parseInt(process.env.LIVE_MIN_PLATFORMS || '2', 10),
  registryRefreshInterval: parseInt(process.env.LIVE_REGISTRY_REFRESH_MS || '30000', 10),
  matcherInterval: parseInt(process.env.LIVE_MATCHER_INTERVAL_MS || '10000', 10),
  preGameWindow: parseInt(process.env.LIVE_PRE_GAME_WINDOW_MS || '3600000', 10),
  postGameWindow: parseInt(process.env.LIVE_POST_GAME_WINDOW_MS || '300000', 10),
  minTokenOverlap: parseInt(process.env.LIVE_MIN_TOKEN_OVERLAP || '2', 10),
  minCoverage: parseFloat(process.env.LIVE_MIN_COVERAGE || '0.6'),
};

/**
 * Build the matcher config using KV-backed runtime flags while still honoring
 * optional env-based tuning knobs for advanced deployments.
 */
export function buildLiveEventMatcherConfig(
  overrides: Partial<LiveEventMatcherConfig> = {}
): LiveEventMatcherConfig {
  const runtime = getCachedLiveArbRuntimeConfig();

  return {
    ...DEFAULT_LIVE_EVENT_MATCHER_CONFIG,
    ...ENV_MATCHER_OVERRIDES,
    enabled: runtime.ruleBasedMatcherEnabled,
    sportsOnly: runtime.sportsOnly,
    ...overrides,
  };
}


