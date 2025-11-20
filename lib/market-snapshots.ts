import { promises as fs } from 'fs';
import path from 'path';
import { Market } from '@/types';

const DEFAULT_SNAPSHOT_DIR = path.join(process.cwd(), 'data', 'market-snapshots');
const TMP_FALLBACK_DIR = '/tmp/market-snapshots';

const userConfiguredDir = process.env.MARKET_SNAPSHOT_DIR;
const preferredDirs: string[] = [];

if (userConfiguredDir) {
  preferredDirs.push(userConfiguredDir);
}

if (process.env.VERCEL) {
  preferredDirs.push(TMP_FALLBACK_DIR);
}

preferredDirs.push(DEFAULT_SNAPSHOT_DIR);

let resolvedSnapshotDir: string | null = null;
let resolvingPromise: Promise<string | null> | null = null;
let warnedDisabled = false;

export interface MarketSnapshot {
  platform: Market['platform'];
  fetchedAt: string;
  maxDaysToExpiry?: number;
  totalMarkets: number;
  markets: Market[];
}

async function resolveSnapshotDirectory(): Promise<string | null> {
  if (resolvedSnapshotDir !== null || warnedDisabled) {
    return resolvedSnapshotDir;
  }

  if (resolvingPromise) {
    return resolvingPromise;
  }

  resolvingPromise = (async () => {
    for (const candidate of preferredDirs) {
      try {
        await fs.mkdir(candidate, { recursive: true });
        console.info(`[Snapshots] Using directory ${candidate}`);
        resolvedSnapshotDir = candidate;
        warnedDisabled = false;
        return candidate;
      } catch (error: any) {
        const code = error?.code;
        if (code === 'EROFS' || code === 'EACCES' || code === 'ENOTDIR') {
          console.warn(
            `[Snapshots] Cannot write to ${candidate} (${code}). ${
              candidate !== TMP_FALLBACK_DIR ? 'Trying next option...' : 'Fallback also failed.'
            }`
          );
          continue;
        }
        console.warn(`[Snapshots] Failed to prepare snapshot directory (${code ?? 'unknown'}).`);
        return null;
      }
    }
    console.warn('[Snapshots] No writable directory available; snapshotting disabled for this process.');
    warnedDisabled = true;
    resolvedSnapshotDir = null;
    return null;
  })();

  const dir = await resolvingPromise;
  resolvingPromise = null;
  return dir;
}

async function writeSnapshot(
  platform: Market['platform'],
  markets: Market[],
  options: { maxDaysToExpiry?: number }
): Promise<void> {
  const dir = await resolveSnapshotDirectory();
  if (!dir) {
    return;
  }

  const snapshot: MarketSnapshot = {
    platform,
    fetchedAt: new Date().toISOString(),
    maxDaysToExpiry: options.maxDaysToExpiry,
    totalMarkets: markets.length,
    markets,
  };

  const filePath = path.join(dir, `${platform}.json`);
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

