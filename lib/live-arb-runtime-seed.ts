import { LiveArbRuntimeConfig, DEFAULT_LIVE_ARB_RUNTIME_CONFIG } from '@/types/live-arb';

/**
 * Helper to build the initial live-arb runtime config.
 * Defaults are fully defined in code; no environment toggles are respected.
 */
export function buildLiveArbRuntimeSeed(): LiveArbRuntimeConfig {
  return { ...DEFAULT_LIVE_ARB_RUNTIME_CONFIG };
}

