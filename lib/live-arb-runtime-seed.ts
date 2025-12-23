import { LiveArbRuntimeConfig, DEFAULT_LIVE_ARB_RUNTIME_CONFIG } from '@/types/live-arb';

/**
 * Helper to build the initial live-arb runtime config.
 * Respects Phase 6 bring-up mode env toggles.
 */
export function buildLiveArbRuntimeSeed(): LiveArbRuntimeConfig {
  // Phase 6: Allow PRE watchers for bring-up/testing
  const allowPreWatchers = process.env.LIVE_ARB_ALLOW_PRE_WATCHERS === 'true';
  const maxPreWatcherSubscriptions = parseInt(
    process.env.LIVE_ARB_MAX_PRE_WATCHER_SUBSCRIPTIONS || '10',
    10
  );
  
  return {
    ...DEFAULT_LIVE_ARB_RUNTIME_CONFIG,
    allowPreWatchers,
    maxPreWatcherSubscriptions: Number.isFinite(maxPreWatcherSubscriptions) 
      ? maxPreWatcherSubscriptions 
      : 10,
  };
}

