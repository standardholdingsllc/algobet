import { promises as fs } from 'fs';
import path from 'path';
import { Market } from '@/types';

const SNAPSHOT_DIR = path.join(process.cwd(), 'data', 'market-snapshots');

export interface MarketSnapshot {
  platform: Market['platform'];
  fetchedAt: string;
  maxDaysToExpiry?: number;
  totalMarkets: number;
  markets: Market[];
}

async function ensureSnapshotDir(): Promise<void> {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
}

async function writeSnapshot(
  platform: Market['platform'],
  markets: Market[],
  options: { maxDaysToExpiry?: number }
): Promise<void> {
  await ensureSnapshotDir();

  const snapshot: MarketSnapshot = {
    platform,
    fetchedAt: new Date().toISOString(),
    maxDaysToExpiry: options.maxDaysToExpiry,
    totalMarkets: markets.length,
    markets,
  };

  const filePath = path.join(SNAPSHOT_DIR, `${platform}.json`);
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

  const relativePath = path.relative(process.cwd(), filePath);
  console.info(
    `[Snapshots] Wrote ${markets.length} ${platform} markets to ${relativePath}${
      options.maxDaysToExpiry ? ` (≤ ${options.maxDaysToExpiry}d)` : ''
    }`
  );
}

export async function saveMarketSnapshots(
  platformMarkets: Record<string, Market[]>,
  options: { maxDaysToExpiry?: number } = {}
): Promise<void> {
  const tasks = Object.entries(platformMarkets).map(([platform, markets]) =>
    writeSnapshot(platform as Market['platform'], markets, options)
  );
  await Promise.all(tasks);
}

