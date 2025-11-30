import { LiveArbRuntimeConfig, DEFAULT_LIVE_ARB_RUNTIME_CONFIG } from '@/types/live-arb';

/**
 * Helper to build the initial live-arb runtime config from environment vars.
 * Environment switches are treated as optional hints – defaults remain safe.
 */
export function buildLiveArbRuntimeSeed(): LiveArbRuntimeConfig {
  const envEnabled = process.env.LIVE_ARB_ENABLED;
  const envMatcher = process.env.LIVE_RULE_BASED_MATCHER_ENABLED;
  const envSportsOnly = process.env.LIVE_RULE_BASED_SPORTS_ONLY;
  const envLiveEventsOnly = process.env.LIVE_ARB_LIVE_EVENTS_ONLY;

  return {
    liveArbEnabled:
      envEnabled === 'true'
        ? true
        : envEnabled === 'false'
          ? false
          : DEFAULT_LIVE_ARB_RUNTIME_CONFIG.liveArbEnabled,
    ruleBasedMatcherEnabled:
      envMatcher === 'true'
        ? true
        : envMatcher === 'false'
          ? false
          : DEFAULT_LIVE_ARB_RUNTIME_CONFIG.ruleBasedMatcherEnabled,
    sportsOnly:
      envSportsOnly === 'true'
        ? true
        : envSportsOnly === 'false'
          ? false
          : DEFAULT_LIVE_ARB_RUNTIME_CONFIG.sportsOnly,
    liveEventsOnly:
      envLiveEventsOnly === 'true'
        ? true
        : envLiveEventsOnly === 'false'
          ? false
          : DEFAULT_LIVE_ARB_RUNTIME_CONFIG.liveEventsOnly,
  };
}

