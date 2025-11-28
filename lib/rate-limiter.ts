/**
 * Rate Limiter
 *
 * Simple per-platform rate limiting for REST API calls.
 * Uses a token bucket algorithm with configurable rates per platform.
 */

import { LiveEventPlatform } from '@/types/live-events';

// ============================================================================
// Configuration
// ============================================================================

interface RateLimitConfig {
  /** Maximum requests per second */
  maxRequestsPerSecond: number;
  /** Bucket size (burst capacity) */
  bucketSize: number;
}

/** Default rate limits - conservative based on vendor docs */
const DEFAULT_RATE_LIMITS: Record<LiveEventPlatform, RateLimitConfig> = {
  // SX.bet: No documented rate limit, being conservative
  SXBET: { maxRequestsPerSecond: 5, bucketSize: 10 },
  // Polymarket: No strict rate limit documented, being conservative
  POLYMARKET: { maxRequestsPerSecond: 5, bucketSize: 10 },
  // Kalshi: Documented limits vary by endpoint, using conservative default
  KALSHI: { maxRequestsPerSecond: 5, bucketSize: 10 },
};

/** Get rate limit config from env or defaults */
function getRateLimitConfig(platform: LiveEventPlatform): RateLimitConfig {
  const envKey = `${platform}_MAX_RPS`;
  const envValue = process.env[envKey];
  
  if (envValue) {
    const rps = parseInt(envValue, 10);
    if (!isNaN(rps) && rps > 0) {
      return { maxRequestsPerSecond: rps, bucketSize: rps * 2 };
    }
  }
  
  return DEFAULT_RATE_LIMITS[platform];
}

// ============================================================================
// Token Bucket State
// ============================================================================

interface BucketState {
  tokens: number;
  lastRefillAt: number;
  totalRequests: number;
  blockedRequests: number;
}

const buckets: Record<LiveEventPlatform, BucketState> = {
  SXBET: { tokens: 10, lastRefillAt: Date.now(), totalRequests: 0, blockedRequests: 0 },
  POLYMARKET: { tokens: 10, lastRefillAt: Date.now(), totalRequests: 0, blockedRequests: 0 },
  KALSHI: { tokens: 10, lastRefillAt: Date.now(), totalRequests: 0, blockedRequests: 0 },
};

// ============================================================================
// Rate Limiter Implementation
// ============================================================================

/**
 * Refill tokens based on time elapsed
 */
function refillBucket(platform: LiveEventPlatform): void {
  const config = getRateLimitConfig(platform);
  const bucket = buckets[platform];
  const now = Date.now();
  
  const elapsedMs = now - bucket.lastRefillAt;
  const tokensToAdd = (elapsedMs / 1000) * config.maxRequestsPerSecond;
  
  bucket.tokens = Math.min(config.bucketSize, bucket.tokens + tokensToAdd);
  bucket.lastRefillAt = now;
}

/**
 * Check if a request can be made (without consuming a token)
 */
export function canRequest(platform: LiveEventPlatform): boolean {
  refillBucket(platform);
  return buckets[platform].tokens >= 1;
}

/**
 * Record a request (consume a token)
 * Returns false if rate limited
 */
export function recordRequest(platform: LiveEventPlatform): boolean {
  refillBucket(platform);
  const bucket = buckets[platform];
  
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    bucket.totalRequests++;
    return true;
  }
  
  bucket.blockedRequests++;
  return false;
}

/**
 * Acquire permission to make a request (combines check + record)
 * Returns true if allowed, false if rate limited
 */
export function acquireRateLimit(platform: LiveEventPlatform): boolean {
  return recordRequest(platform);
}

/**
 * Get current rate limiter stats
 */
export function getRateLimiterStats(): Record<LiveEventPlatform, {
  availableTokens: number;
  totalRequests: number;
  blockedRequests: number;
  config: RateLimitConfig;
}> {
  const stats: Record<string, any> = {};
  
  for (const platform of ['SXBET', 'POLYMARKET', 'KALSHI'] as LiveEventPlatform[]) {
    refillBucket(platform);
    const bucket = buckets[platform];
    
    stats[platform] = {
      availableTokens: Math.floor(bucket.tokens),
      totalRequests: bucket.totalRequests,
      blockedRequests: bucket.blockedRequests,
      config: getRateLimitConfig(platform),
    };
  }
  
  return stats as any;
}

/**
 * Reset rate limiter stats (for testing)
 */
export function resetRateLimiter(): void {
  for (const platform of ['SXBET', 'POLYMARKET', 'KALSHI'] as LiveEventPlatform[]) {
    const config = getRateLimitConfig(platform);
    buckets[platform] = {
      tokens: config.bucketSize,
      lastRefillAt: Date.now(),
      totalRequests: 0,
      blockedRequests: 0,
    };
  }
}

/**
 * Log rate limiter status
 */
export function logRateLimiterStatus(): void {
  const stats = getRateLimiterStats();
  console.log('[RateLimiter] Current status:');
  for (const [platform, stat] of Object.entries(stats)) {
    console.log(
      `  ${platform}: ${stat.availableTokens}/${stat.config.bucketSize} tokens, ` +
      `${stat.totalRequests} requests, ${stat.blockedRequests} blocked`
    );
  }
}

