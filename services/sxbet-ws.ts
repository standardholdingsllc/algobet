/**
 * SX.bet WebSocket Client
 *
 * Connects to SX.bet's real-time data feed for:
 * - Line/odds changes
 * - Live score updates
 * - Best odds streaming
 * - Order book updates
 *
 * IMPORTANT: SX.bet WebSocket Implementation Notes
 * ================================================
 * Per SX.bet API docs (https://api.docs.sx.bet/#websocket-api):
 * - SX.bet uses Ably for their WebSocket streaming
 * - The exact Ably channel names and message formats may vary
 * - This implementation attempts to connect via direct WebSocket
 *   but may need adjustment based on production behavior
 *
 * If direct WebSocket fails:
 * - Consider using the official Ably client library
 * - Authenticate via SX.bet's token endpoint first
 * - Subscribe to appropriate Ably channels
 *
 * Channels documented (may need Ably format):
 * - Market updates (line changes, odds)
 * - Live score updates
 * - Order book / best odds
 *
 * Design decisions:
 * - Uses native WebSocket with proper reconnection logic
 * - Pushes all updates to LivePriceCache for unified access
 * - Follows existing services/ patterns
 * - Graceful degradation if WS is unavailable
 */

import WebSocket from 'ws';
import {
  WsConnectionState,
  WsClientConfig,
  WsClientStatus,
  DEFAULT_WS_CONFIG,
  LivePriceUpdate,
  LiveScoreUpdate,
  WsStateHandler,
} from '@/types/live-arb';
import { LivePriceCache } from '@/lib/live-price-cache';
import { liveArbLog } from '@/lib/live-arb-logger';

// ============================================================================
// Configuration
// ============================================================================

/** Default SX.bet WebSocket URL - may need to be Ably endpoint in production */
const DEFAULT_SXBET_WS_URL = 'wss://api.sx.bet/ws';
const WS_LOG_TAG = 'SXBET-WS';
const RECONNECT_WARNING_MS = 15000;
const wsInfo = (message: string, meta?: unknown) =>
  liveArbLog('info', WS_LOG_TAG, message, meta);
const wsWarn = (message: string, meta?: unknown) =>
  liveArbLog('warn', WS_LOG_TAG, message, meta);
const wsError = (message: string, meta?: unknown) =>
  liveArbLog('error', WS_LOG_TAG, message, meta);
const wsDebug = (message: string, meta?: unknown) =>
  liveArbLog('debug', WS_LOG_TAG, message, meta);

/** Alternative Ably-based URL pattern (if SX.bet uses Ably) */
const ABLY_WS_URL_PATTERN = 'wss://realtime.ably.io';

// ============================================================================
// SX.bet WebSocket Message Types
// ============================================================================

interface SxBetWsMessage {
  type?: string | number;
  channel?: string;
  data?: any;
  action?: string | number;
  name?: string | number; // Ably message name
}

interface SxBetOddsUpdate {
  marketHash: string;
  outcomeOneName?: string;
  outcomeTwoName?: string;
  outcomeOne?: {
    percentageOdds: string | null;
    updatedAt?: number;
  };
  outcomeTwo?: {
    percentageOdds: string | null;
    updatedAt?: number;
  };
}

interface SxBetScoreUpdate {
  sportXeventId: string;
  homeScore?: number;
  awayScore?: number;
  gameStatus?: number;
  period?: number;
  clockTime?: string;
  sportLabel?: string;
}

interface SxBetLineChange {
  marketHash: string;
  line?: number;
  previousLine?: number;
  outcomeOneOdds?: string;
  outcomeTwoOdds?: string;
}

// ============================================================================
// Statistics for monitoring
// ============================================================================

interface SxBetWsStats {
  messagesReceived: number;
  oddsUpdates: number;
  scoreUpdates: number;
  lineChanges: number;
  errors: number;
  lastErrorMessage?: string;
}

// ============================================================================
// SX.bet WebSocket Client
// ============================================================================

export class SxBetWsClient {
  private ws: WebSocket | null = null;
  private config: WsClientConfig;
  private state: WsConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectWarningTimer: NodeJS.Timeout | null = null;
  private connectedAt?: Date;
  private lastMessageAt?: Date;
  private subscribedMarkets: Set<string> = new Set();
  private pendingSubscriptions: Set<string> = new Set();
  private stateHandlers: Set<WsStateHandler> = new Set();
  private errorMessage?: string;
  private stats: SxBetWsStats = {
    messagesReceived: 0,
    oddsUpdates: 0,
    scoreUpdates: 0,
    lineChanges: 0,
    errors: 0,
  };

  private readonly wsUrl: string;
  private readonly apiKey: string;

  constructor(config?: Partial<WsClientConfig>) {
    this.config = { ...DEFAULT_WS_CONFIG, ...config };
    this.wsUrl = process.env.SXBET_WS_URL || DEFAULT_SXBET_WS_URL;
    this.apiKey = process.env.SXBET_API_KEY || '';
  }

  // --------------------------------------------------------------------------
  // Connection Management
  // --------------------------------------------------------------------------

  /**
   * Connect to SX.bet WebSocket
   *
   * Note: If this fails with auth errors, the SX.bet WS may require:
   * 1. Token-based authentication via their REST API first
   * 2. Using the Ably client library instead of raw WebSocket
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      wsInfo('Already connected or connecting');
      return;
    }

    if (!this.apiKey) {
      const error = 'SXBET_API_KEY not configured - WebSocket will not connect';
      wsWarn(error);
      this.errorMessage = error;
      this.setState('error');
      // Don't throw - allow graceful degradation
      return;
    }

    this.setState('connecting');
    wsInfo(`Connecting to ${this.wsUrl}...`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.state === 'connecting') {
          const error = 'Connection timeout';
          this.errorMessage = error;
          this.ws?.close();
          this.setState('error');
          wsWarn('Connection timeout - will retry');
          resolve(); // Don't reject, allow graceful degradation
        }
      }, this.config.connectionTimeoutMs);

      try {
        this.ws = new WebSocket(this.wsUrl, {
          headers: {
            'X-Api-Key': this.apiKey,
            'Authorization': `Bearer ${this.apiKey}`,
          },
        });

        this.ws.on('open', () => {
          clearTimeout(timeout);
          this.connectedAt = new Date();
          this.reconnectAttempts = 0;
          this.setState('connected');
          wsInfo('Connected successfully');

          // Send initialization/auth message
          this.sendAuthMessage();

          // Start heartbeat
          this.startHeartbeat();

          // Process any pending subscriptions
          this.processPendingSubscriptions();

          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error: Error) => {
          clearTimeout(timeout);
          wsError('WebSocket error', { message: error.message });
          this.errorMessage = error.message;
          this.stats.errors++;
          this.stats.lastErrorMessage = error.message;
          if (this.state === 'connecting') {
            this.setState('error');
            resolve(); // Don't reject, allow graceful degradation
          }
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          clearTimeout(timeout);
          const reasonStr = reason.toString() || 'unknown';
          wsInfo('Connection closed', { code, reason: reasonStr });
          this.stopHeartbeat();
          this.handleDisconnect();
        });
      } catch (error: any) {
        clearTimeout(timeout);
        this.errorMessage = error.message;
        this.setState('error');
        wsError('Failed to create WebSocket', { error: error.message });
        resolve(); // Don't reject, allow graceful degradation
      }
    });
  }

  /**
   * Send authentication message after connection
   */
  private sendAuthMessage(): void {
    // Try multiple auth formats as SX.bet protocol may vary
    this.sendMessage({
      type: 'auth',
      apiKey: this.apiKey,
    });

    // Also try Ably-style attach
    this.sendMessage({
      action: 10, // Ably attach action
      channel: 'markets',
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    wsInfo('Disconnecting websocket');
    this.stopReconnectTimer();
    this.stopHeartbeat();
    
    // Keep subscribed markets for potential reconnection
    // but clear pending
    this.pendingSubscriptions.clear();

    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnect');
      } catch (e) {
        // Ignore close errors
      }
      this.ws = null;
    }

    this.setState('disconnected');
  }

  /**
   * Handle disconnection and attempt reconnection
   */
  private handleDisconnect(): void {
    this.ws = null;

    if (this.state === 'disconnected') {
      // Intentional disconnect, don't reconnect
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      wsError('Max reconnection attempts reached', {
        maxAttempts: this.config.maxReconnectAttempts,
      });
      this.setState('error');
      return;
    }

    this.setState('reconnecting');
    this.scheduleReconnect();
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    const delay = Math.min(
      this.config.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts),
      this.config.reconnectMaxDelayMs
    );

    wsInfo(`Scheduling reconnect attempt ${this.reconnectAttempts + 1} in ${delay}ms`, {
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
        // Resubscribe to markets after reconnection
        await this.resubscribe();
      } catch (error) {
        wsError('Reconnection failed', { error });
      }
    }, delay);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Heartbeat
  // --------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Try both ping frame and JSON ping
        try {
          this.ws.ping();
        } catch (e) {
          // Ignore ping errors
        }
        this.sendMessage({ type: 'ping' });
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------

  private sendMessage(message: SxBetWsMessage | object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error: any) {
        wsError('Failed to send message', { error: error.message });
      }
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    this.lastMessageAt = new Date();
    this.stats.messagesReceived++;

    try {
      const message: SxBetWsMessage = JSON.parse(data.toString());
      const msgType = message.type || message.action || message.name;

      switch (msgType) {
        case 'pong':
        case 1: // Ably heartbeat ack
          // Heartbeat response, ignore
          break;

        case 'odds':
        case 'best-odds':
        case 'marketOdds':
          this.handleOddsUpdate(message.data);
          break;

        case 'line-change':
        case 'lineChange':
        case 'market':
          this.handleLineChange(message.data);
          break;

        case 'score':
        case 'live-score':
        case 'liveScore':
        case 'gameState':
          this.handleScoreUpdate(message.data);
          break;

        case 'orderbook':
        case 'book':
          this.handleOrderbookUpdate(message.data);
          break;

        case 'subscribed':
        case 'attached': // Ably attached confirmation
          wsInfo(`Subscribed to ${message.channel}`);
          break;

        case 'auth':
        case 'connected':
          wsInfo('Authentication confirmed');
          break;

        case 'error':
          wsError('Server error', message.data);
          this.stats.errors++;
          this.stats.lastErrorMessage = JSON.stringify(message.data);
          break;

        default:
          // Try to infer message type from content
          if (message.data?.marketHash && message.data?.outcomeOne) {
            this.handleOddsUpdate(message.data);
          } else if (message.data?.sportXeventId && message.data?.homeScore !== undefined) {
            this.handleScoreUpdate(message.data);
          } else {
            // Log unknown message types for debugging (at debug level)
            if (process.env.LIVE_ARB_LOG_LEVEL === 'debug') {
              wsDebug(`Unknown message: ${String(msgType)}`, { message });
            }
          }
      }
    } catch (error) {
      wsError('Failed to parse websocket message', error as Error);
      this.stats.errors++;
    }
  }

  /**
   * Handle odds/best-odds updates
   */
  private handleOddsUpdate(data: SxBetOddsUpdate | SxBetOddsUpdate[] | undefined): void {
    if (!data) return;
    const updates = Array.isArray(data) ? data : [data];

    for (const update of updates) {
      if (!update.marketHash) continue;

      // Update outcome one (typically home team / yes)
      if (update.outcomeOne?.percentageOdds) {
        const decimalOdds = this.percentageOddsToDecimal(
          update.outcomeOne.percentageOdds
        );
        if (decimalOdds) {
          const priceUpdate: LivePriceUpdate = {
            key: {
              platform: 'sxbet',
              marketId: update.marketHash,
              outcomeId: 'outcome1',
            },
            price: decimalOdds,
            impliedProbability: 1 / decimalOdds,
            source: 'websocket',
          };
          LivePriceCache.updateLivePrice(priceUpdate);
          this.stats.oddsUpdates++;
        }
      }

      // Update outcome two (typically away team / no)
      if (update.outcomeTwo?.percentageOdds) {
        const decimalOdds = this.percentageOddsToDecimal(
          update.outcomeTwo.percentageOdds
        );
        if (decimalOdds) {
          const priceUpdate: LivePriceUpdate = {
            key: {
              platform: 'sxbet',
              marketId: update.marketHash,
              outcomeId: 'outcome2',
            },
            price: decimalOdds,
            impliedProbability: 1 / decimalOdds,
            source: 'websocket',
          };
          LivePriceCache.updateLivePrice(priceUpdate);
          this.stats.oddsUpdates++;
        }
      }
    }
  }

  /**
   * Handle line change updates (odds movement)
   */
  private handleLineChange(data: SxBetLineChange | SxBetLineChange[] | undefined): void {
    if (!data) return;
    const changes = Array.isArray(data) ? data : [data];

    for (const change of changes) {
      if (!change.marketHash) continue;

      // Update odds from line change
      if (change.outcomeOneOdds) {
        const decimalOdds = this.percentageOddsToDecimal(change.outcomeOneOdds);
        if (decimalOdds) {
          LivePriceCache.updateLivePrice({
            key: {
              platform: 'sxbet',
              marketId: change.marketHash,
              outcomeId: 'outcome1',
            },
            price: decimalOdds,
            impliedProbability: 1 / decimalOdds,
            source: 'websocket',
          });
          this.stats.lineChanges++;
        }
      }

      if (change.outcomeTwoOdds) {
        const decimalOdds = this.percentageOddsToDecimal(change.outcomeTwoOdds);
        if (decimalOdds) {
          LivePriceCache.updateLivePrice({
            key: {
              platform: 'sxbet',
              marketId: change.marketHash,
              outcomeId: 'outcome2',
            },
            price: decimalOdds,
            impliedProbability: 1 / decimalOdds,
            source: 'websocket',
          });
          this.stats.lineChanges++;
        }
      }
    }
  }

  /**
   * Handle live score updates
   */
  private handleScoreUpdate(data: SxBetScoreUpdate | SxBetScoreUpdate[] | undefined): void {
    if (!data) return;
    const updates = Array.isArray(data) ? data : [data];

    for (const update of updates) {
      if (!update.sportXeventId) continue;

      const scoreUpdate: LiveScoreUpdate = {
        fixtureId: update.sportXeventId,
        homeScore: update.homeScore ?? 0,
        awayScore: update.awayScore ?? 0,
        gamePhase: this.parseGameStatus(update.gameStatus),
        period: update.period,
        clockTime: update.clockTime,
        sportLabel: update.sportLabel,
      };

      LivePriceCache.updateLiveScore(scoreUpdate);
      this.stats.scoreUpdates++;
    }
  }

  /**
   * Handle orderbook updates
   */
  private handleOrderbookUpdate(data: any): void {
    if (data?.marketHash) {
      this.handleOddsUpdate(data);
    }
  }

  /**
   * Convert SX.bet percentage odds to decimal odds
   * SX.bet uses: percentageOdds / 10^20 = implied probability
   */
  private percentageOddsToDecimal(percentageOdds: string): number | null {
    try {
      const oddsWei = BigInt(percentageOdds);
      const divisor = BigInt('100000000000000000000'); // 10^20
      const impliedProb = Number(oddsWei) / Number(divisor);

      if (impliedProb <= 0 || impliedProb >= 1) {
        return null;
      }

      // Taker gets opposite probability
      const takerProb = 1 - impliedProb;
      const decimalOdds = 1 / takerProb;

      return Math.max(1.01, decimalOdds);
    } catch {
      return null;
    }
  }

  /**
   * Parse SX.bet game status to our game phase
   * Status codes per SX.bet docs:
   * 0 = Pre-game
   * 1 = Live/In-play
   * 2 = Halftime/Break
   * 3 = Ended/Final
   */
  private parseGameStatus(
    status?: number
  ): 'pre' | 'live' | 'halftime' | 'ended' | 'unknown' {
    if (status === undefined || status === null) return 'unknown';

    switch (status) {
      case 0:
        return 'pre';
      case 1:
        return 'live';
      case 2:
        return 'halftime';
      case 3:
        return 'ended';
      default:
        return 'unknown';
    }
  }

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  /**
   * Process pending subscriptions after connection
   */
  private processPendingSubscriptions(): void {
    if (this.pendingSubscriptions.size > 0) {
      wsInfo(`Processing ${this.pendingSubscriptions.size} pending subscriptions`);
      for (const marketHash of this.pendingSubscriptions) {
        this.doSubscribe(marketHash);
      }
      this.pendingSubscriptions.clear();
    }
  }

  /**
   * Subscribe to odds updates for a market
   */
  subscribeToMarket(marketHash: string): void {
    if (this.subscribedMarkets.has(marketHash)) {
      return;
    }

    this.subscribedMarkets.add(marketHash);

    if (this.isConnected()) {
      this.doSubscribe(marketHash);
    } else {
      // Queue for later if not connected
      this.pendingSubscriptions.add(marketHash);
    }
  }

  /**
   * Actually send subscription message
   */
  private doSubscribe(marketHash: string): void {
    // Try multiple subscription formats
    this.sendMessage({
      type: 'subscribe',
      channel: 'odds',
      data: { marketHash },
    });

    // Also try Ably-style subscription
    this.sendMessage({
      action: 10, // Ably attach
      channel: `market:${marketHash}`,
    });
  }

  /**
   * Subscribe to odds updates for multiple markets
   */
  subscribeToMarkets(marketHashes: string[]): void {
    for (const hash of marketHashes) {
      this.subscribeToMarket(hash);
    }
  }

  /**
   * Subscribe to best odds stream (global)
   */
  subscribeToBestOdds(): void {
    this.sendMessage({
      type: 'subscribe',
      channel: 'best-odds',
    });
    wsInfo('Subscribed to best-odds stream');
  }

  /**
   * Subscribe to live scores (global)
   */
  subscribeToLiveScores(): void {
    this.sendMessage({
      type: 'subscribe',
      channel: 'live-scores',
    });
    wsInfo('Subscribed to live-scores stream');
  }

  /**
   * Subscribe to line changes (global)
   */
  subscribeToLineChanges(): void {
    this.sendMessage({
      type: 'subscribe',
      channel: 'line-changes',
    });
    wsInfo('Subscribed to line-changes stream');
  }

  /**
   * Unsubscribe from a market
   */
  unsubscribeFromMarket(marketHash: string): void {
    this.subscribedMarkets.delete(marketHash);
    this.pendingSubscriptions.delete(marketHash);
    
    if (this.isConnected()) {
      this.sendMessage({
        type: 'unsubscribe',
        channel: 'odds',
        data: { marketHash },
      });
    }
  }

  /**
   * Unsubscribe from multiple markets
   */
  unsubscribeFromMarkets(marketHashes: string[]): void {
    for (const hash of marketHashes) {
      this.unsubscribeFromMarket(hash);
    }
  }

  /**
   * Resubscribe to all markets after reconnection
   */
  private async resubscribe(): Promise<void> {
    const markets = Array.from(this.subscribedMarkets);
    wsInfo(`Resubscribing to ${markets.length} markets`);

    // Resubscribe to global feeds
    this.subscribeToBestOdds();
    this.subscribeToLiveScores();
    this.subscribeToLineChanges();

    // Resubscribe to individual markets
    for (const market of markets) {
      this.doSubscribe(market);
    }
  }

  /**
   * Get list of currently subscribed markets
   */
  getSubscribedMarkets(): string[] {
    return Array.from(this.subscribedMarkets);
  }

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------

  private setState(newState: WsConnectionState): void {
    const oldState = this.state;
    this.state = newState;

    if (oldState !== newState) {
      liveArbLog('info', WS_LOG_TAG, `State change: ${oldState} → ${newState}`);
      if (newState === 'reconnecting' || newState === 'error') {
        this.scheduleReconnectWarning(newState);
      } else {
        this.clearReconnectWarning();
      }
      this.notifyStateChange();
    }
  }

  private scheduleReconnectWarning(state: WsConnectionState): void {
    this.clearReconnectWarning();
    this.reconnectWarningTimer = setTimeout(() => {
      if (this.state === state) {
        liveArbLog(
          'warn',
          WS_LOG_TAG,
          `WARNING: stuck in ${state} state`,
          { attempts: this.reconnectAttempts, lastError: this.errorMessage }
        );
      }
    }, RECONNECT_WARNING_MS);
  }

  private clearReconnectWarning(): void {
    if (this.reconnectWarningTimer) {
      clearTimeout(this.reconnectWarningTimer);
      this.reconnectWarningTimer = null;
    }
  }

  private notifyStateChange(): void {
    const status = this.getStatus();
    for (const handler of this.stateHandlers) {
      try {
        handler(status);
      } catch (error) {
        wsError('Error in state handler', error as Error);
      }
    }
  }

  /**
   * Subscribe to connection state changes
   */
  onStateChange(handler: WsStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  /**
   * Get current connection status
   */
  getStatus(): WsClientStatus {
    return {
      state: this.state,
      platform: 'sxbet',
      connectedAt: this.connectedAt?.toISOString(),
      lastMessageAt: this.lastMessageAt?.toISOString(),
      reconnectAttempts: this.reconnectAttempts,
      subscribedMarkets: this.subscribedMarkets.size,
      errorMessage: this.errorMessage,
    };
  }

  /**
   * Get detailed statistics
   */
  getStats(): SxBetWsStats {
    return { ...this.stats };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let sxBetWsInstance: SxBetWsClient | null = null;

/**
 * Get or create the SX.bet WebSocket client singleton
 */
export function getSxBetWsClient(config?: Partial<WsClientConfig>): SxBetWsClient {
  if (!sxBetWsInstance) {
    sxBetWsInstance = new SxBetWsClient(config);
  }
  return sxBetWsInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetSxBetWsClient(): void {
  if (sxBetWsInstance) {
    sxBetWsInstance.disconnect();
    sxBetWsInstance = null;
  }
}
