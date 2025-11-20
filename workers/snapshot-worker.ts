import { MarketFeedService } from '../lib/market-feed-service';
import { KVStorage } from '../lib/kv-storage';
import { SNAPSHOT_REFRESH_INTERVAL_MS } from '../lib/constants';

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
    await this.feedService.persistSnapshots(
      payloads,
      filters,
      config.maxDaysToExpiry
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

