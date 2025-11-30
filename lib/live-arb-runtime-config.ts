import { LiveArbRuntimeConfig, DEFAULT_LIVE_ARB_RUNTIME_CONFIG } from '@/types/live-arb';
import { KVStorage } from './kv-storage';
import { buildLiveArbRuntimeSeed } from './live-arb-runtime-seed';

let cachedRuntimeConfig: LiveArbRuntimeConfig | null = null;

export async function loadLiveArbRuntimeConfig(): Promise<LiveArbRuntimeConfig> {
  if (cachedRuntimeConfig) {
    return cachedRuntimeConfig;
  }
  const config = await KVStorage.getLiveArbRuntimeConfig();
  cachedRuntimeConfig = config;
  return config;
}

export function getCachedLiveArbRuntimeConfig(): LiveArbRuntimeConfig {
  return cachedRuntimeConfig ?? DEFAULT_LIVE_ARB_RUNTIME_CONFIG;
}

export async function updateLiveArbRuntimeConfig(
  updates: Partial<LiveArbRuntimeConfig>
): Promise<LiveArbRuntimeConfig> {
  const next = await KVStorage.updateLiveArbRuntimeConfig(updates);
  cachedRuntimeConfig = next;
  return next;
}

export function resetLiveArbRuntimeConfigCache(): void {
  cachedRuntimeConfig = null;
}

export function primeLiveArbRuntimeConfig(config: LiveArbRuntimeConfig): void {
  cachedRuntimeConfig = config;
}

// Utility for tests to inspect the seeded defaults without touching KV.
export function previewLiveArbRuntimeSeed(): LiveArbRuntimeConfig {
  return buildLiveArbRuntimeSeed();
}

