import {
  previewLiveArbRuntimeSeed,
  resetLiveArbRuntimeConfigCache,
  loadLiveArbRuntimeConfig,
  updateLiveArbRuntimeConfig,
} from '../lib/live-arb-runtime-config';
import { KVStorage } from '../lib/kv-storage';

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║ LIVE-ARB RUNTIME CONFIG TEST                         ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  delete process.env.LIVE_ARB_ENABLED;
  delete process.env.LIVE_RULE_BASED_MATCHER_ENABLED;
  delete process.env.LIVE_RULE_BASED_SPORTS_ONLY;
  delete process.env.LIVE_ARB_LIVE_EVENTS_ONLY;

  console.log('➡️  Default seed (no env overrides)');
  console.log(previewLiveArbRuntimeSeed());

  process.env.LIVE_ARB_ENABLED = 'false';
  process.env.LIVE_RULE_BASED_MATCHER_ENABLED = 'false';
  process.env.LIVE_RULE_BASED_SPORTS_ONLY = 'false';
  process.env.LIVE_ARB_LIVE_EVENTS_ONLY = 'true';
  console.log('\n➡️  Seed with env overrides');
  console.log(previewLiveArbRuntimeSeed());

  // Mock KV calls so this script does not require Upstash credentials.
  const mockStore = {
    liveArbEnabled: true,
    ruleBasedMatcherEnabled: true,
    sportsOnly: true,
    liveEventsOnly: false,
  };

  resetLiveArbRuntimeConfigCache();

  (KVStorage as any).getLiveArbRuntimeConfig = async () => {
    console.log('\n[MockKV] getLiveArbRuntimeConfig called');
    return mockStore;
  };

  (KVStorage as any).updateLiveArbRuntimeConfig = async (updates: any) => {
    console.log('\n[MockKV] updateLiveArbRuntimeConfig called with', updates);
    Object.assign(mockStore, updates);
    return mockStore;
  };

  const loaded = await loadLiveArbRuntimeConfig();
  console.log('\n✅ Loaded runtime config from KV/cache:', loaded);

  const updated = await updateLiveArbRuntimeConfig({
    liveEventsOnly: true,
    liveArbEnabled: false,
  });
  console.log('\n✅ Updated runtime config (KV now):', updated);

  console.log('\nAll runtime-config tests completed!\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

