import { MarketPlatform } from '@/types';

export const SNAPSHOT_PLATFORMS: readonly MarketPlatform[] = [
  'kalshi',
  'polymarket',
  'sxbet',
] as const;

export function normalizeSnapshotPlatformParam(
  value: string | string[] | undefined
): MarketPlatform | null {
  if (!value) {
    return null;
  }

  const normalized = (Array.isArray(value) ? value[0] : value).toLowerCase();
  return SNAPSHOT_PLATFORMS.includes(normalized as MarketPlatform)
    ? (normalized as MarketPlatform)
    : null;
}

