import { promises as fs } from 'fs';
import path from 'path';
import { Redis } from '@upstash/redis';
import { Market, MarketSnapshot, MarketFilterInput, MarketPlatform } from '@/types';
import {
  MARKET_SNAPSHOT_KV_PREFIX,
  MARKET_SNAPSHOT_TTL_SECONDS,
} from './constants';

export const MARKET_SNAPSHOT_SCHEMA_VERSION = 2;
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
const redisClient =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      })
    : null;
let redisWarningEmitted = false;
const diskReadCache = new Map<MarketPlatform, MarketSnapshot>();

export type SnapshotSource = 'redis' | 'disk';

export interface LoadedSnapshot {
  snapshot: MarketSnapshot | null;
  source?: SnapshotSource;
}

interface SnapshotWriteOptions {
  maxDaysToExpiry?: number;
  adapterId?: string;
  filters?: MarketFilterInput;
  schemaVersion?: number;
}

export interface SnapshotLoadOptions {
  maxAgeMs?: number;
}

export interface SnapshotValidationResult {
  valid: boolean;
  errors: string[];
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
  platform: MarketPlatform,
  markets: Market[],
  options: SnapshotWriteOptions = {}
): Promise<void> {
  const snapshot: MarketSnapshot = {
    schemaVersion: options.schemaVersion ?? MARKET_SNAPSHOT_SCHEMA_VERSION,
    platform,
    fetchedAt: new Date().toISOString(),
    maxDaysToExpiry: options.maxDaysToExpiry,
    adapterId: options.adapterId,
    filters: options.filters,
    totalMarkets: markets.length,
    markets,
  };

  const validation = validateMarketSnapshot(snapshot);
  if (!validation.valid) {
    throw new Error(
      `[Snapshots] Refusing to persist invalid snapshot for ${platform}: ${validation.errors.join(
        '; '
      )}`
    );
  }

  await Promise.all([
    writeSnapshotToDisk(platform, snapshot),
    writeSnapshotToRedis(platform, snapshot),
  ]);
}

export async function saveMarketSnapshots(
  platformMarkets: Record<string, Market[]>,
  options: {
    maxDaysToExpiry?: number;
    filters?: MarketFilterInput;
    perPlatformOptions?: Partial<Record<MarketPlatform, SnapshotWriteOptions>>;
  } = {}
): Promise<void> {
  const tasks = Object.entries(platformMarkets).map(([platform, markets]) => {
    const platformKey = platform as MarketPlatform;
    const platformOverride = options.perPlatformOptions?.[platformKey] ?? {};
    return writeSnapshot(platformKey, markets, {
      maxDaysToExpiry:
        platformOverride.maxDaysToExpiry ?? options.maxDaysToExpiry,
      filters: platformOverride.filters ?? options.filters,
      adapterId: platformOverride.adapterId,
      schemaVersion: platformOverride.schemaVersion,
    });
  });
  await Promise.all(tasks);
}

async function writeSnapshotToDisk(
  platform: MarketPlatform,
  snapshot: MarketSnapshot
): Promise<void> {
  const dir = await resolveSnapshotDirectory();
  if (!dir) {
    return;
  }

  const filePath = path.join(dir, `${platform}.json`);
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  diskReadCache.set(platform, snapshot);

  const relativePath = path.relative(process.cwd(), filePath);
  console.info(
    `[Snapshots] Wrote ${snapshot.totalMarkets} ${platform} markets to ${relativePath}` +
      `${snapshot.maxDaysToExpiry ? ` (≤ ${snapshot.maxDaysToExpiry}d)` : ''} ` +
      `(schema v${snapshot.schemaVersion})`
  );
}

function getSnapshotRedisKey(platform: MarketPlatform): string {
  return `${MARKET_SNAPSHOT_KV_PREFIX}:${platform}`;
}

async function writeSnapshotToRedis(
  platform: MarketPlatform,
  snapshot: MarketSnapshot
): Promise<void> {
  if (!redisClient) {
    if (!redisWarningEmitted) {
      console.warn(
        '[Snapshots] Upstash credentials not set; skipping Redis persistence.'
      );
      redisWarningEmitted = true;
    }
    return;
  }

  try {
    const key = getSnapshotRedisKey(platform);
    await redisClient.set(key, snapshot, {
      ex: MARKET_SNAPSHOT_TTL_SECONDS,
    });
  } catch (error: any) {
    console.warn(
      '[Snapshots] Failed to persist snapshot to Upstash:',
      error?.message || error
    );
  }
}

async function readSnapshotFromRedis(
  platform: MarketPlatform
): Promise<MarketSnapshot | null> {
  if (!redisClient) {
    return null;
  }

  try {
    const key = getSnapshotRedisKey(platform);
    const snapshot = await redisClient.get<MarketSnapshot>(key);
    if (!snapshot) {
      return null;
    }

    const validation = validateMarketSnapshot(snapshot);
    if (!validation.valid) {
      console.warn(
        `[Snapshots] Invalid Redis snapshot for ${platform}: ${validation.errors.join(
          '; '
        )}`
      );
      return null;
    }

    return snapshot;
  } catch (error: any) {
    console.warn(
      `[Snapshots] Failed to read ${platform} snapshot from Upstash:`,
      error?.message || error
    );
    return null;
  }
}

async function readSnapshotFromDisk(
  platform: MarketPlatform
): Promise<MarketSnapshot | null> {
  const dir = await resolveSnapshotDirectory();
  if (!dir) {
    return null;
  }

  const filePath = path.join(dir, `${platform}.json`);
  try {
    if (diskReadCache.has(platform)) {
      return diskReadCache.get(platform)!;
    }

    const raw = await fs.readFile(filePath, 'utf-8');
    const snapshot = JSON.parse(raw) as MarketSnapshot;
    const validation = validateMarketSnapshot(snapshot);
    if (!validation.valid) {
      console.warn(
        `[Snapshots] Invalid disk snapshot for ${platform}: ${validation.errors.join(
          '; '
        )}`
      );
      return null;
    }
    diskReadCache.set(platform, snapshot);
    return snapshot;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn(
        `[Snapshots] Failed to read ${platform} snapshot from disk:`,
        error?.message || error
      );
    }
    return null;
  }
}

export async function loadMarketSnapshot(
  platform: MarketPlatform
): Promise<MarketSnapshot | null> {
  const { snapshot } = await loadMarketSnapshotWithSource(platform);
  return snapshot;
}

export async function loadMarketSnapshotWithSource(
  platform: MarketPlatform
): Promise<LoadedSnapshot> {
  const redisSnapshot = await readSnapshotFromRedis(platform);
  if (redisSnapshot) {
    return { snapshot: redisSnapshot, source: 'redis' };
  }
  const diskSnapshot = await readSnapshotFromDisk(platform);
  if (diskSnapshot) {
    return { snapshot: diskSnapshot, source: 'disk' };
  }
  return { snapshot: null, source: undefined };
}

export async function loadMarketsFromSnapshot(
  platform: MarketPlatform,
  options: SnapshotLoadOptions = {}
): Promise<Market[]> {
  const snapshot = await loadMarketSnapshot(platform);
  if (!snapshot) {
    return [];
  }

  if (
    options.maxAgeMs &&
    !isSnapshotFresh(snapshot, options.maxAgeMs)
  ) {
    console.warn(
      `[Snapshots] ${platform} snapshot is stale (fetched ${snapshot.fetchedAt})`
    );
  }

  return snapshot.markets;
}

export function isSnapshotFresh(
  snapshot: MarketSnapshot,
  maxAgeMs: number
): boolean {
  const fetchedAt = new Date(snapshot.fetchedAt).getTime();
  if (Number.isNaN(fetchedAt)) {
    return false;
  }
  return Date.now() - fetchedAt <= maxAgeMs;
}

export function getSnapshotAgeMs(snapshot: MarketSnapshot): number | null {
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (Number.isNaN(fetchedAt)) {
    return null;
  }
  return Date.now() - fetchedAt;
}

export function validateMarketSnapshot(
  snapshot: MarketSnapshot
): SnapshotValidationResult {
  const errors: string[] = [];

  if (typeof snapshot.schemaVersion !== 'number') {
    errors.push('schemaVersion missing or invalid');
  }
  if (!snapshot.platform) {
    errors.push('platform missing');
  }
  if (!snapshot.fetchedAt || Number.isNaN(Date.parse(snapshot.fetchedAt))) {
    errors.push('fetchedAt invalid');
  }
  if (!Array.isArray(snapshot.markets)) {
    errors.push('markets missing or not array');
  } else {
    snapshot.markets.forEach((market, index) => {
      if (!market.id || typeof market.id !== 'string') {
        errors.push(`market[${index}] missing id`);
      }
      if (market.platform !== snapshot.platform) {
        errors.push(`market[${index}] platform mismatch (${market.platform})`);
      }
      if (!market.expiryDate || Number.isNaN(Date.parse(market.expiryDate))) {
        errors.push(`market[${index}] invalid expiryDate`);
      }
      if (
        typeof market.yesPrice !== 'number' ||
        typeof market.noPrice !== 'number'
      ) {
        errors.push(`market[${index}] missing prices`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

