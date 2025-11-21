import path from 'path';
import { MarketSnapshot } from '@/types';
import { MarketFeedService } from '../lib/market-feed-service';
import { KVStorage } from '../lib/kv-storage';
import {
  MARKET_SNAPSHOT_KV_PREFIX,
  SNAPSHOT_REFRESH_INTERVAL_MS,
} from '../lib/constants';
import { getSnapshotDirectory } from '../lib/market-snapshots';

const REFRESH_INTERVAL_MS = Number(
  process.env.SNAPSHOT_REFRESH_INTERVAL_MS || SNAPSHOT_REFRESH_INTERVAL_MS
);

class SnapshotWorker {
  private feedService = new MarketFeedService();
  private running = false;

  async start() {
    console.log('📸 Starting Market Snapshot Worker...');
    this.running = true;

    while (this.running) {
      const startedAt = Date.now();
      try {
        await this.refreshSnapshots();
        const duration = Date.now() - startedAt;
        console.log(
          `[SnapshotWorker] Refresh completed in ${duration}ms. Sleeping for ${REFRESH_INTERVAL_MS}ms`
        );
      } catch (error: any) {
        console.error(
          '[SnapshotWorker] Refresh failed:',
          error?.message || error
        );
      }

      await this.sleep(REFRESH_INTERVAL_MS);
    }
  }

  stop() {
    console.log('🛑 Stopping Market Snapshot Worker...');
    this.running = false;
  }

  private async refreshSnapshots() {
    const config = await KVStorage.getConfig();
    const filters = this.feedService.buildFiltersFromConfig(config);
    const payloads = await this.feedService.fetchLiveMarketsForPlatforms(filters);
    const savedSnapshots = await this.feedService.persistSnapshots(
      payloads,
      filters,
      config.maxDaysToExpiry
    );
    const snapshotDir = await getSnapshotDirectory();
    const timestamp = new Date().toISOString();
    (Object.entries(savedSnapshots) as [string, MarketSnapshot][]).forEach(
      ([platform, snapshot]) => {
        const diskPath = snapshotDir
          ? path.join(snapshotDir, `${platform}.json`)
          : 'disabled';
        console.info(
          `[SnapshotWorker] Saved snapshot for ${platform} at ${timestamp} ` +
            `(totalMarkets=${snapshot.totalMarkets}, adapterId=${
              snapshot.adapterId ?? 'n/a'
            }, schemaVersion=${snapshot.schemaVersion})`
        );
        console.info(
          `[SnapshotWorker] Redis key=${MARKET_SNAPSHOT_KV_PREFIX}:${platform}, diskPath=${diskPath}`
        );
      }
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const worker = new SnapshotWorker();
worker.start().catch((error) => {
  console.error('Snapshot worker failed to start:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  worker.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  worker.stop();
  process.exit(0);
});

