import { LiveArbRuntimeConfig, DEFAULT_LIVE_ARB_RUNTIME_CONFIG } from '@/types/live-arb';
import { KVStorage } from './kv-storage';
import { buildLiveArbRuntimeSeed } from './live-arb-runtime-seed';

const RUNTIME_CONFIG_CACHE_TTL_MS = Math.max(
  0,
  parseInt(process.env.LIVE_ARB_RUNTIME_CONFIG_CACHE_MS || '0', 10)
);

let cachedRuntimeConfig: LiveArbRuntimeConfig | null = null;
let lastRuntimeConfigFetchAt = 0;

export async function loadLiveArbRuntimeConfig(): Promise<LiveArbRuntimeConfig> {
  const now = Date.now();
  const cacheValid =
    !!cachedRuntimeConfig &&
    RUNTIME_CONFIG_CACHE_TTL_MS > 0 &&
    now - lastRuntimeConfigFetchAt < RUNTIME_CONFIG_CACHE_TTL_MS;

  if (cacheValid) {
    return cachedRuntimeConfig!;
  }

  const config = await KVStorage.getLiveArbRuntimeConfig();
  cachedRuntimeConfig = config;
  lastRuntimeConfigFetchAt = now;
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
  lastRuntimeConfigFetchAt = Date.now();
  return next;
}

export function resetLiveArbRuntimeConfigCache(): void {
  cachedRuntimeConfig = null;
  lastRuntimeConfigFetchAt = 0;
}

export function primeLiveArbRuntimeConfig(config: LiveArbRuntimeConfig): void {
  cachedRuntimeConfig = config;
  lastRuntimeConfigFetchAt = Date.now();
}

// Utility for tests to inspect the seeded defaults without touching KV.
export function previewLiveArbRuntimeSeed(): LiveArbRuntimeConfig {
  return buildLiveArbRuntimeSeed();
}

