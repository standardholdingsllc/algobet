/**
 * Type definitions for Live-Event Arbitrage
 *
 * These types extend the existing AlgoBet types to support real-time
 * WebSocket data feeds and live arbitrage detection.
 */

import { MarketPlatform, Market, ArbitrageOpportunity } from './index';

// ============================================================================
// Market Keys & Identifiers
// ============================================================================

/**
 * Canonical key for identifying a specific outcome on a specific platform.
 * Format follows the existing MarketKey pattern from types/index.ts
 */
export interface LiveMarketKey {
  platform: MarketPlatform;
  marketId: string;
  /** For binary markets: 'yes' | 'no'. For sportsbook: 'outcome1' | 'outcome2' */
  outcomeId: string;
}

/**
 * Serialize a LiveMarketKey to a string for use as Map key
 */
export function serializeLiveMarketKey(key: LiveMarketKey): string {
  return `${key.platform}:${key.marketId}:${key.outcomeId}`;
}

/**
 * Parse a serialized key back to LiveMarketKey
 */
export function parseLiveMarketKey(serialized: string): LiveMarketKey | null {
  const parts = serialized.split(':');
  if (parts.length < 3) return null;
  const [platform, marketId, ...outcomeParts] = parts;
  return {
    platform: platform as MarketPlatform,
    marketId,
    outcomeId: outcomeParts.join(':'), // Handle colons in outcomeId
  };
}

// ============================================================================
// Live Price Data
// ============================================================================

/**
 * A single live price entry in the cache
 */
export interface LivePriceEntry {
  key: LiveMarketKey;
  /**
   * Price in the platform's native format:
   * - Kalshi/Polymarket: cents (0-100)
   * - SX.bet: decimal odds (e.g., 1.5, 2.0)
   */
  price: number;
  /** Implied probability (0-1) */
  impliedProbability: number;
  /** ISO timestamp of when this price was received */
  lastUpdatedAt: string;
  /** Milliseconds since this price was updated (computed at read time) */
  ageMs?: number;
  /** Source of the update */
  source: 'websocket' | 'rest' | 'snapshot';
  /** Additional metadata */
  meta?: {
    /** Best bid price (if available) */
    bestBid?: number;
    /** Best ask price (if available) */
    bestAsk?: number;
    /** Spread in the same units as price */
    spread?: number;
    /** Available liquidity at this price */
    liquidity?: number;
  };
}

/**
 * Update payload pushed to the cache from WebSocket handlers
 */
export interface LivePriceUpdate {
  key: LiveMarketKey;
  price: number;
  impliedProbability?: number;
  source: 'websocket' | 'rest';
  meta?: LivePriceEntry['meta'];
}

// ============================================================================
// Live Score Data (SX.bet only)
// ============================================================================

/**
 * Live score entry for in-play games (SX.bet only)
 */
export interface LiveScoreEntry {
  /** Fixture/game ID from SX.bet */
  fixtureId: string;
  /** Home team score */
  homeScore: number;
  /** Away team score */
  awayScore: number;
  /** Current game phase */
  gamePhase: 'pre' | 'live' | 'halftime' | 'ended' | 'unknown';
  /** Period/quarter/half (sport-specific) */
  period?: number;
  /** Clock time remaining (if available) */
  clockTime?: string;
  /** ISO timestamp when this score was received */
  lastUpdatedAt: string;
  /** Sport label for context */
  sportLabel?: string;
}

/**
 * Score update payload from SX.bet WebSocket
 */
export interface LiveScoreUpdate {
  fixtureId: string;
  homeScore: number;
  awayScore: number;
  gamePhase: LiveScoreEntry['gamePhase'];
  period?: number;
  clockTime?: string;
  sportLabel?: string;
}

// ============================================================================
// WebSocket Client Types
// ============================================================================

export type WsConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface WsClientConfig {
  /** Maximum reconnection attempts before giving up */
  maxReconnectAttempts: number;
  /** Base delay for exponential backoff (ms) */
  reconnectBaseDelayMs: number;
  /** Maximum delay between reconnection attempts (ms) */
  reconnectMaxDelayMs: number;
  /** Heartbeat/ping interval (ms) */
  heartbeatIntervalMs: number;
  /** Connection timeout (ms) */
  connectionTimeoutMs: number;
}

export const DEFAULT_WS_CONFIG: WsClientConfig = {
  maxReconnectAttempts: 10,
  reconnectBaseDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  heartbeatIntervalMs: 30000,
  connectionTimeoutMs: 10000,
};

export interface WsClientStatus {
  state: WsConnectionState;
  platform: MarketPlatform;
  connectedAt?: string;
  lastMessageAt?: string;
  reconnectAttempts: number;
  subscribedMarkets: number;
  errorMessage?: string;
}

// ============================================================================
// Live Arb Detection
// ============================================================================

/**
 * A live arbitrage opportunity detected from real-time data
 */
export interface LiveArbOpportunity extends ArbitrageOpportunity {
  /** Timestamp when this opportunity was detected */
  detectedAt: string;
  /** How stale the prices are (max age of either leg in ms) */
  maxPriceAgeMs: number;
  /** Whether this opportunity uses live scores for context */
  hasLiveScoreContext: boolean;
  /** Live score data if available */
  liveScore?: LiveScoreEntry;
  /** Source of the price data */
  priceSource: {
    market1: 'websocket' | 'rest' | 'snapshot';
    market2: 'websocket' | 'rest' | 'snapshot';
  };
}

/**
 * Configuration for live arbitrage detection
 */
export interface LiveArbConfig {
  /** Whether live arb is enabled */
  enabled: boolean;
  /** Minimum profit margin in basis points (e.g., 50 = 0.5%) */
  minProfitBps: number;
  /** Maximum price age to consider (ms) */
  maxPriceAgeMs: number;
  /** Maximum latency for execution (ms) */
  maxExecutionLatencyMs: number;
  /** Only consider live/in-play events */
  liveEventsOnly: boolean;
  /** Maximum slippage tolerance in basis points */
  maxSlippageBps: number;
  /** Platforms to enable for live arb */
  enabledPlatforms: MarketPlatform[];
}

export const DEFAULT_LIVE_ARB_CONFIG: LiveArbConfig = {
  enabled: false,
  minProfitBps: 50, // 0.5%
  maxPriceAgeMs: 2000, // 2 seconds
  maxExecutionLatencyMs: 5000, // 5 seconds
  liveEventsOnly: false,
  maxSlippageBps: 100, // 1%
  enabledPlatforms: ['kalshi', 'polymarket', 'sxbet'],
};

/**
 * KV-backed runtime configuration that the UI controls.
 * Environment variables only seed the very first copy of this config.
 */
export interface LiveArbRuntimeConfig {
  liveArbEnabled: boolean;
  ruleBasedMatcherEnabled: boolean;
  sportsOnly: boolean;
  liveEventsOnly: boolean;
  /** Phase 6: Allow creating watchers for PRE events (bring-up mode) */
  allowPreWatchers?: boolean;
  /** Phase 6: Maximum subscriptions for PRE watchers */
  maxPreWatcherSubscriptions?: number;
}

export const DEFAULT_LIVE_ARB_RUNTIME_CONFIG: LiveArbRuntimeConfig = {
  liveArbEnabled: true,
  ruleBasedMatcherEnabled: true,
  sportsOnly: true,
  liveEventsOnly: true,
  allowPreWatchers: false,  // Phase 6: Default disabled
  maxPreWatcherSubscriptions: 10,
};

// ============================================================================
// Circuit Breaker Types
// ============================================================================

export interface CircuitBreakerState {
  /** Whether the circuit is currently open (trading halted) */
  isOpen: boolean;
  /** Reason the circuit was opened */
  openReason?: string;
  /** Timestamp when the circuit was opened */
  openedAt?: string;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Last error message */
  lastError?: string;
}

export interface CircuitBreakerConfig {
  /** Maximum consecutive failures before opening circuit */
  maxConsecutiveFailures: number;
  /** Maximum loss in a rolling window before halting */
  maxLossUsd: number;
  /** Rolling window for loss calculation (ms) */
  lossWindowMs: number;
  /** Maximum latency before considering a price stale */
  maxLatencyMs: number;
  /** Cooldown period after circuit opens (ms) */
  cooldownMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveFailures: 3,
  maxLossUsd: 100,
  lossWindowMs: 3600000, // 1 hour
  maxLatencyMs: 5000,
  cooldownMs: 300000, // 5 minutes
};

// ============================================================================
// Event Handlers
// ============================================================================

export type LivePriceHandler = (update: LivePriceUpdate) => void;
export type LiveScoreHandler = (update: LiveScoreUpdate) => void;
export type LiveArbHandler = (opportunity: LiveArbOpportunity) => void;
export type WsStateHandler = (status: WsClientStatus) => void;

