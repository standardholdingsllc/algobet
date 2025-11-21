import {
  isSnapshotFresh,
  getSnapshotAgeMs,
  MARKET_SNAPSHOT_SCHEMA_VERSION,
} from '../lib/market-snapshots';
import { MarketSnapshot } from '../types';

function createSnapshot(offsetMs: number): MarketSnapshot {
  const fetchedAt = new Date(Date.now() - offsetMs).toISOString();
  return {
    schemaVersion: MARKET_SNAPSHOT_SCHEMA_VERSION,
    platform: 'kalshi',
    fetchedAt,
    totalMarkets: 1,
    markets: [
      {
        id: 'test',
        ticker: 'test',
        platform: 'kalshi',
        marketType: 'prediction',
        title: 'Test market',
        yesPrice: 50,
        noPrice: 50,
        expiryDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    ],
  };
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

console.log('🧪 Testing snapshot freshness helpers...');

const freshSnapshot = createSnapshot(10_000);
assert(
  isSnapshotFresh(freshSnapshot, 60_000),
  'Snapshot should be fresh within TTL'
);
const age = getSnapshotAgeMs(freshSnapshot);
assert(age !== null && age >= 9_000 && age <= 20_000, 'Age should be computed');

const staleSnapshot = createSnapshot(10 * 60 * 1000);
assert(
  !isSnapshotFresh(staleSnapshot, 60_000),
  'Snapshot older than TTL should be stale'
);

const invalidSnapshot: MarketSnapshot = {
  ...freshSnapshot,
  fetchedAt: 'invalid-date',
};
assert(
  !isSnapshotFresh(invalidSnapshot, 60_000),
  'Invalid timestamps should be treated as stale'
);
assert(
  getSnapshotAgeMs(invalidSnapshot) === null,
  'Invalid timestamps should return null age'
);

console.log('✅ Snapshot helper tests passed.');

