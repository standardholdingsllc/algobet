#!/usr/bin/env ts-node
/**
 * Test Live WebSocket Connections
 *
 * This script tests the WebSocket connections to all platforms without
 * starting the full bot. Useful for verifying credentials and connectivity.
 *
 * Usage:
 *   npm run test-live-ws
 *   # or
 *   npx ts-node scripts/test-live-ws-connections.ts
 *
 * Environment variables required:
 *   - SXBET_API_KEY (for SX.bet)
 *   - KALSHI_API_KEY, KALSHI_PRIVATE_KEY (for Kalshi)
 *   - POLYMARKET_API_KEY (optional for Polymarket)
 *
 * The script will:
 *   1. Load configuration from environment
 *   2. Connect to each platform's WebSocket
 *   3. Subscribe to a few test markets
 *   4. Log connection events, messages received
 *   5. Gracefully disconnect on SIGINT
 */

import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

function loadEnvFile(relativePath: string): void {
  const filePath = resolve(__dirname, relativePath);
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, 'utf-8');
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Load environment variables similar to dotenv (but without dependency)
loadEnvFile('../.env.local');
loadEnvFile('../.env');

import { getSxBetWsClient, resetSxBetWsClient } from '../services/sxbet-ws';
import { getPolymarketWsClient, resetPolymarketWsClient } from '../services/polymarket-ws';
import { getKalshiWsClient, resetKalshiWsClient } from '../services/kalshi-ws';
import { LivePriceCache } from '../lib/live-price-cache';

// ============================================================================
// Configuration
// ============================================================================

const TEST_DURATION_MS = 30000; // Run for 30 seconds by default
const MAX_MESSAGES_TO_LOG = 10; // Log first N messages per platform

interface PlatformStats {
  connected: boolean;
  connectTime?: number;
  messagesReceived: number;
  lastMessageAt?: Date;
  errors: string[];
  subscriptions: number;
}

const stats: Record<string, PlatformStats> = {
  sxbet: { connected: false, messagesReceived: 0, errors: [], subscriptions: 0 },
  polymarket: { connected: false, messagesReceived: 0, errors: [], subscriptions: 0 },
  kalshi: { connected: false, messagesReceived: 0, errors: [], subscriptions: 0 },
};

// Track shutdown state
let isShuttingDown = false;

// ============================================================================
// Helper Functions
// ============================================================================

function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function logError(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ ${message}`);
}

function logSuccess(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ✅ ${message}`);
}

function checkEnvVar(name: string, required: boolean = false): string | undefined {
  const value = process.env[name];
  if (required && !value) {
    logError(`Missing required environment variable: ${name}`);
  } else if (!value) {
    log(`ℹ️  Optional env var not set: ${name}`);
  } else {
    log(`✓ ${name} is configured`);
  }
  return value;
}

// ============================================================================
// Platform Connection Tests
// ============================================================================

async function testSxBetConnection(): Promise<void> {
  log('\n📡 Testing SX.bet WebSocket connection...');

  const apiKey = checkEnvVar('SXBET_API_KEY', true);
  if (!apiKey) {
    stats.sxbet.errors.push('Missing API key');
    return;
  }

  try {
    const client = getSxBetWsClient();
    const startTime = Date.now();

    client.onStateChange((status) => {
      log(`[SX.bet] State: ${status.state}`);
      if (status.state === 'connected') {
        stats.sxbet.connected = true;
        stats.sxbet.connectTime = Date.now() - startTime;
        logSuccess(`SX.bet connected in ${stats.sxbet.connectTime}ms`);
      } else if (status.state === 'error') {
        stats.sxbet.errors.push(status.errorMessage || 'Unknown error');
      }
    });

    await client.connect();

    if (client.isConnected()) {
      // Subscribe to global feeds
      client.subscribeToBestOdds();
      client.subscribeToLiveScores();
      stats.sxbet.subscriptions = 2;
      log('[SX.bet] Subscribed to global feeds');
    }
  } catch (error: any) {
    stats.sxbet.errors.push(error.message);
    logError(`SX.bet connection failed: ${error.message}`);
  }
}

async function testPolymarketConnection(): Promise<void> {
  log('\n📡 Testing Polymarket WebSocket connection...');

  // Polymarket WS is public for price data
  try {
    const client = getPolymarketWsClient();
    const startTime = Date.now();

    client.onStateChange((status) => {
      log(`[Polymarket] State: ${status.state}`);
      if (status.state === 'connected') {
        stats.polymarket.connected = true;
        stats.polymarket.connectTime = Date.now() - startTime;
        logSuccess(`Polymarket connected in ${stats.polymarket.connectTime}ms`);
      } else if (status.state === 'error') {
        stats.polymarket.errors.push(status.errorMessage || 'Unknown error');
      }
    });

    await client.connect();

    // Note: Polymarket needs specific market IDs to subscribe
    // For testing, we can try subscribing to any known active market
    log('[Polymarket] Connection test complete (no test markets subscribed)');
  } catch (error: any) {
    stats.polymarket.errors.push(error.message);
    logError(`Polymarket connection failed: ${error.message}`);
  }
}

async function testKalshiConnection(): Promise<void> {
  log('\n📡 Testing Kalshi WebSocket connection...');

  const apiKey = checkEnvVar('KALSHI_API_KEY');
  const privateKey = checkEnvVar('KALSHI_PRIVATE_KEY');

  if (!apiKey || !privateKey) {
    log('[Kalshi] Skipping - credentials not configured');
    stats.kalshi.errors.push('Missing credentials');
    return;
  }

  try {
    const client = getKalshiWsClient();
    const startTime = Date.now();

    client.onStateChange((status) => {
      log(`[Kalshi] State: ${status.state}`);
      if (status.state === 'connected') {
        stats.kalshi.connected = true;
        stats.kalshi.connectTime = Date.now() - startTime;
        logSuccess(`Kalshi connected in ${stats.kalshi.connectTime}ms`);
      } else if (status.state === 'error') {
        stats.kalshi.errors.push(status.errorMessage || 'Unknown error');
      }
    });

    await client.connect();
    log('[Kalshi] Connection test complete');
  } catch (error: any) {
    stats.kalshi.errors.push(error.message);
    logError(`Kalshi connection failed: ${error.message}`);
  }
}

// ============================================================================
// Price Cache Monitoring
// ============================================================================

function setupPriceCacheMonitoring(): void {
  log('\n📊 Setting up price cache monitoring...');

  LivePriceCache.onPriceUpdate((update) => {
    const platform = update.key.platform;
    stats[platform].messagesReceived++;
    stats[platform].lastMessageAt = new Date();

    // Log first N messages per platform
    if (stats[platform].messagesReceived <= MAX_MESSAGES_TO_LOG) {
      log(
        `[${platform}] Price update #${stats[platform].messagesReceived}: ` +
          `market=${update.key.marketId.substring(0, 16)}..., ` +
          `outcome=${update.key.outcomeId}, price=${update.price.toFixed(2)}`
      );
    } else if (stats[platform].messagesReceived === MAX_MESSAGES_TO_LOG + 1) {
      log(`[${platform}] (Suppressing further price logs...)`);
    }
  });

  LivePriceCache.onScoreUpdate((update) => {
    log(
      `[sxbet] Score update: fixture=${update.fixtureId}, ` +
        `${update.homeScore}-${update.awayScore}, phase=${update.gamePhase}`
    );
  });
}

// ============================================================================
// Cleanup and Summary
// ============================================================================

function printSummary(): void {
  log('\n' + '='.repeat(60));
  log('📋 TEST SUMMARY');
  log('='.repeat(60));

  for (const [platform, platformStats] of Object.entries(stats)) {
    const status = platformStats.connected ? '✅ CONNECTED' : '❌ NOT CONNECTED';
    const connectTimeStr = platformStats.connectTime
      ? `(${platformStats.connectTime}ms)`
      : '';

    console.log(`\n${platform.toUpperCase()} ${status} ${connectTimeStr}`);
    console.log(`  Messages received: ${platformStats.messagesReceived}`);
    console.log(`  Subscriptions: ${platformStats.subscriptions}`);

    if (platformStats.lastMessageAt) {
      console.log(`  Last message: ${platformStats.lastMessageAt.toISOString()}`);
    }

    if (platformStats.errors.length > 0) {
      console.log(`  Errors: ${platformStats.errors.join(', ')}`);
    }
  }

  // Print cache stats
  const cacheStats = LivePriceCache.getStats();
  console.log('\n📊 PRICE CACHE STATS:');
  console.log(`  Price entries: ${cacheStats.priceCacheSize}`);
  console.log(`  Score entries: ${cacheStats.scoreCacheSize}`);
  console.log(`  Total updates: ${cacheStats.totalPriceUpdates}`);
  console.log(`  Updates by platform:`, cacheStats.priceUpdatesByPlatform);

  log('\n' + '='.repeat(60));
}

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log('\n🛑 Shutting down...');

  try {
    resetSxBetWsClient();
    resetPolymarketWsClient();
    resetKalshiWsClient();
    LivePriceCache.clearAll();
  } catch (error) {
    // Ignore shutdown errors
  }

  printSummary();
  process.exit(0);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('🔌 LIVE WEBSOCKET CONNECTION TEST');
  console.log('='.repeat(60));
  console.log(`Test duration: ${TEST_DURATION_MS / 1000} seconds`);
  console.log(`Max messages logged per platform: ${MAX_MESSAGES_TO_LOG}`);

  // Setup shutdown handlers
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Check environment
  log('\n📋 Checking environment variables...');
  checkEnvVar('SXBET_API_KEY');
  checkEnvVar('SXBET_WS_URL');
  checkEnvVar('KALSHI_API_KEY');
  checkEnvVar('KALSHI_PRIVATE_KEY');
  checkEnvVar('POLYMARKET_WS_URL');
  checkEnvVar('LIVE_ARB_ENABLED');

  // Setup monitoring before connecting
  setupPriceCacheMonitoring();

  // Connect to all platforms
  await Promise.all([
    testSxBetConnection(),
    testPolymarketConnection(),
    testKalshiConnection(),
  ]);

  log('\n⏳ Monitoring for messages...');
  log(`   Press Ctrl+C to stop early, or wait ${TEST_DURATION_MS / 1000}s`);

  // Wait for test duration
  await new Promise((resolve) => setTimeout(resolve, TEST_DURATION_MS));

  // Shutdown and print results
  await shutdown();
}

// Run the test
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

