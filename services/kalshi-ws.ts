/**
 * Kalshi WebSocket Client
 *
 * Connects to Kalshi's WebSocket for:
 * - Orderbook delta updates
 * - Ticker updates
 * - Trade notifications
 *
 * Based on Kalshi API docs: https://docs.kalshi.com/welcome
 *
 * Note: Kalshi is price-only (no live scores).
 */

import WebSocket from 'ws';
import {
  WsConnectionState,
  WsClientConfig,
  WsClientStatus,
  DEFAULT_WS_CONFIG,
  LivePriceUpdate,
  WsStateHandler,
} from '@/types/live-arb';
import { LivePriceCache } from '@/lib/live-price-cache';
import { liveArbLog } from '@/lib/live-arb-logger';

// ============================================================================
// Kalshi WebSocket Message Types
// ============================================================================

interface KalshiWsMessage {
  id?: number;
  type: string;
  msg?: any;
  error?: string;
}

interface KalshiSubscribeMessage {
  id: number;
  cmd: 'subscribe';
  params: {
    channels: string[];
    market_tickers?: string[];
  };
}

interface KalshiOrderbookDelta {
  market_ticker: string;
  price: number;
  delta: number;
  side: 'yes' | 'no';
}

interface KalshiTicker {
  market_ticker: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  volume?: number;
  open_interest?: number;
  timestamp?: string;
}

interface KalshiTrade {
  market_ticker: string;
  price: number;
  count: number;
  side: 'yes' | 'no';
  taker_side: 'yes' | 'no';
  created_time: string;
}

// ============================================================================
// Kalshi WebSocket Client
// ============================================================================

export class KalshiWsClient {
  private ws: WebSocket | null = null;
  private config: WsClientConfig;
  private state: WsConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectWarningTimer: NodeJS.Timeout | null = null;
  private connectedAt?: Date;
  private lastMessageAt?: Date;
  private subscribedTickers: Set<string> = new Set();
  private stateHandlers: Set<WsStateHandler> = new Set();
  private errorMessage?: string;
  private messageId = 0;

  // Kalshi orderbook state (to reconstruct from deltas)
  private orderbookState: Map<
    string,
    {
      yesBids: Map<number, number>;
      yesAsks: Map<number, number>;
      noBids: Map<number, number>;
      noAsks: Map<number, number>;
    }
  > = new Map();

  private readonly wsUrl: string;

const WS_LOG_TAG = 'KALSHI-WS';
const RECONNECT_WARNING_MS = 15000;
const wsInfo = (message: string, meta?: Record<string, unknown>) =>
  liveArbLog('info', WS_LOG_TAG, message, meta);
const wsWarn = (message: string, meta?: Record<string, unknown>) =>
  liveArbLog('warn', WS_LOG_TAG, message, meta);
const wsError = (message: string, meta?: Record<string, unknown>) =>
  liveArbLog('error', WS_LOG_TAG, message, meta);

  constructor(config?: Partial<WsClientConfig>) {
    this.config = { ...DEFAULT_WS_CONFIG, ...config };
    // Kalshi WebSocket URL
    this.wsUrl =
      process.env.KALSHI_WS_URL ||
      'wss://trading-api.kalshi.com/trade-api/ws/v2';
  }

  // --------------------------------------------------------------------------
  // Connection Management
  // --------------------------------------------------------------------------

  /**
   * Connect to Kalshi WebSocket
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      wsInfo('Already connected or connecting');
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
          reject(new Error(error));
        }
      }, this.config.connectionTimeoutMs);

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          this.connectedAt = new Date();
          this.reconnectAttempts = 0;
          this.setState('connected');
          wsInfo('Connected successfully');

          // Start heartbeat
          this.startHeartbeat();

          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error: Error) => {
          clearTimeout(timeout);
          wsError('WebSocket error', { message: error.message });
          this.errorMessage = error.message;
          if (this.state === 'connecting') {
            reject(error);
          }
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          clearTimeout(timeout);
          wsInfo('Connection closed', { code, reason: reason.toString() });
          this.stopHeartbeat();
          this.handleDisconnect();
        });

        this.ws.on('pong', () => {
          // Heartbeat acknowledged
        });
      } catch (error: any) {
        clearTimeout(timeout);
        this.errorMessage = error.message;
        this.setState('error');
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    wsInfo('Disconnecting websocket');
    this.stopReconnectTimer();
    this.stopHeartbeat();
    this.subscribedTickers.clear();
    this.orderbookState.clear();

    if (this.ws) {
      this.ws.close();
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
        this.ws.ping();
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

  private getNextMessageId(): number {
    return ++this.messageId;
  }

  private sendMessage(message: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    this.lastMessageAt = new Date();

    try {
      const message: KalshiWsMessage = JSON.parse(data.toString());

      if (message.error) {
        wsError('Server error', { error: message.error });
        return;
      }

      switch (message.type) {
        case 'orderbook_snapshot':
          this.handleOrderbookSnapshot(message.msg);
          break;

        case 'orderbook_delta':
          this.handleOrderbookDelta(message.msg);
          break;

        case 'ticker':
          this.handleTicker(message.msg);
          break;

        case 'trade':
          this.handleTrade(message.msg);
          break;

        case 'subscribed':
          wsInfo('Subscription confirmed', { message: message.msg });
          break;

        case 'unsubscribed':
          wsInfo('Unsubscription confirmed', { message: message.msg });
          break;

        default:
          // Some messages come without explicit type
          if (message.msg?.market_ticker) {
            // Might be a ticker update
            if (message.msg.yes_bid !== undefined || message.msg.yes_ask !== undefined) {
              this.handleTicker(message.msg);
            }
          }
      }
    } catch (error) {
      wsError('Failed to parse websocket message', error as Error);
    }
  }

  /**
   * Handle initial orderbook snapshot
   */
  private handleOrderbookSnapshot(data: any): void {
    if (!data?.market_ticker) return;

    const ticker = data.market_ticker;

    // Initialize orderbook state
    this.orderbookState.set(ticker, {
      yesBids: new Map(),
      yesAsks: new Map(),
      noBids: new Map(),
      noAsks: new Map(),
    });

    const state = this.orderbookState.get(ticker)!;

    // Populate from snapshot
    if (data.yes?.length) {
      for (const [price, quantity] of data.yes) {
        if (quantity > 0) {
          state.yesBids.set(price, quantity);
        }
      }
    }
    if (data.no?.length) {
      for (const [price, quantity] of data.no) {
        if (quantity > 0) {
          state.noBids.set(price, quantity);
        }
      }
    }

    this.updatePriceFromOrderbook(ticker);
  }

  /**
   * Handle orderbook delta updates
   */
  private handleOrderbookDelta(data: KalshiOrderbookDelta | KalshiOrderbookDelta[]): void {
    const deltas = Array.isArray(data) ? data : [data];

    for (const delta of deltas) {
      if (!delta.market_ticker) continue;

      const ticker = delta.market_ticker;
      let state = this.orderbookState.get(ticker);

      if (!state) {
        // Initialize if we haven't seen this ticker
        state = {
          yesBids: new Map(),
          yesAsks: new Map(),
          noBids: new Map(),
          noAsks: new Map(),
        };
        this.orderbookState.set(ticker, state);
      }

      // Apply delta (delta > 0 = add/increase, delta < 0 = remove/decrease)
      const book = delta.side === 'yes' ? state.yesBids : state.noBids;
      const currentQty = book.get(delta.price) ?? 0;
      const newQty = currentQty + delta.delta;

      if (newQty <= 0) {
        book.delete(delta.price);
      } else {
        book.set(delta.price, newQty);
      }

      this.updatePriceFromOrderbook(ticker);
    }
  }

  /**
   * Handle ticker updates
   */
  private handleTicker(data: KalshiTicker | KalshiTicker[]): void {
    const tickers = Array.isArray(data) ? data : [data];

    for (const ticker of tickers) {
      if (!ticker.market_ticker) continue;

      const marketId = ticker.market_ticker;

      // Calculate YES price (use bid or last_price as fallback)
      let yesPrice: number | null = null;
      if (ticker.yes_bid !== undefined && ticker.yes_bid !== null) {
        yesPrice = ticker.yes_bid;
      } else if (ticker.last_price !== undefined && ticker.last_price !== null) {
        yesPrice = ticker.last_price;
      }

      // Calculate NO price
      let noPrice: number | null = null;
      if (ticker.no_bid !== undefined && ticker.no_bid !== null) {
        noPrice = ticker.no_bid;
      } else if (yesPrice !== null) {
        noPrice = 100 - yesPrice;
      }

      if (yesPrice !== null) {
        LivePriceCache.updateLivePrice({
          key: {
            platform: 'kalshi',
            marketId,
            outcomeId: 'yes',
          },
          price: yesPrice,
          impliedProbability: yesPrice / 100,
          source: 'websocket',
          meta: {
            bestBid: ticker.yes_bid ?? undefined,
            bestAsk: ticker.yes_ask ?? undefined,
            spread:
              ticker.yes_bid !== undefined && ticker.yes_ask !== undefined
                ? ticker.yes_ask - ticker.yes_bid
                : undefined,
          },
        });
      }

      if (noPrice !== null) {
        LivePriceCache.updateLivePrice({
          key: {
            platform: 'kalshi',
            marketId,
            outcomeId: 'no',
          },
          price: noPrice,
          impliedProbability: noPrice / 100,
          source: 'websocket',
          meta: {
            bestBid: ticker.no_bid ?? undefined,
            bestAsk: ticker.no_ask ?? undefined,
            spread:
              ticker.no_bid !== undefined && ticker.no_ask !== undefined
                ? ticker.no_ask - ticker.no_bid
                : undefined,
          },
        });
      }
    }
  }

  /**
   * Handle trade updates
   */
  private handleTrade(data: KalshiTrade | KalshiTrade[]): void {
    const trades = Array.isArray(data) ? data : [data];

    for (const trade of trades) {
      if (!trade.market_ticker) continue;

      // Update price from last trade
      const price = trade.price;
      const side = trade.side;

      if (side === 'yes') {
        LivePriceCache.updateLivePrice({
          key: {
            platform: 'kalshi',
            marketId: trade.market_ticker,
            outcomeId: 'yes',
          },
          price,
          impliedProbability: price / 100,
          source: 'websocket',
        });

        // Also update NO side
        LivePriceCache.updateLivePrice({
          key: {
            platform: 'kalshi',
            marketId: trade.market_ticker,
            outcomeId: 'no',
          },
          price: 100 - price,
          impliedProbability: (100 - price) / 100,
          source: 'websocket',
        });
      } else {
        LivePriceCache.updateLivePrice({
          key: {
            platform: 'kalshi',
            marketId: trade.market_ticker,
            outcomeId: 'no',
          },
          price,
          impliedProbability: price / 100,
          source: 'websocket',
        });

        // Also update YES side
        LivePriceCache.updateLivePrice({
          key: {
            platform: 'kalshi',
            marketId: trade.market_ticker,
            outcomeId: 'yes',
          },
          price: 100 - price,
          impliedProbability: (100 - price) / 100,
          source: 'websocket',
        });
      }
    }
  }

  /**
   * Update cache price from internal orderbook state
   */
  private updatePriceFromOrderbook(ticker: string): void {
    const state = this.orderbookState.get(ticker);
    if (!state) return;

    // Get best yes bid (highest price someone will pay for YES)
    const yesBids = Array.from(state.yesBids.keys()).sort((a, b) => b - a);
    const bestYesBid = yesBids.length > 0 ? yesBids[0] : null;

    // Get best no bid (highest price someone will pay for NO)
    const noBids = Array.from(state.noBids.keys()).sort((a, b) => b - a);
    const bestNoBid = noBids.length > 0 ? noBids[0] : null;

    if (bestYesBid !== null) {
      LivePriceCache.updateLivePrice({
        key: {
          platform: 'kalshi',
          marketId: ticker,
          outcomeId: 'yes',
        },
        price: bestYesBid,
        impliedProbability: bestYesBid / 100,
        source: 'websocket',
        meta: {
          bestBid: bestYesBid,
        },
      });
    }

    if (bestNoBid !== null) {
      LivePriceCache.updateLivePrice({
        key: {
          platform: 'kalshi',
          marketId: ticker,
          outcomeId: 'no',
        },
        price: bestNoBid,
        impliedProbability: bestNoBid / 100,
        source: 'websocket',
        meta: {
          bestBid: bestNoBid,
        },
      });
    }
  }

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  /**
   * Subscribe to ticker and orderbook updates for a market
   */
  subscribeToMarket(ticker: string): void {
    if (this.subscribedTickers.has(ticker)) {
      return;
    }

    this.subscribedTickers.add(ticker);

    const message: KalshiSubscribeMessage = {
      id: this.getNextMessageId(),
      cmd: 'subscribe',
      params: {
        channels: ['ticker', 'orderbook_delta', 'trade'],
        market_tickers: [ticker],
      },
    };

    this.sendMessage(message);
  }

  /**
   * Subscribe to multiple markets
   */
  subscribeToMarkets(tickers: string[]): void {
    const newTickers = tickers.filter((t) => !this.subscribedTickers.has(t));
    if (newTickers.length === 0) return;

    for (const ticker of newTickers) {
      this.subscribedTickers.add(ticker);
    }

    const message: KalshiSubscribeMessage = {
      id: this.getNextMessageId(),
      cmd: 'subscribe',
      params: {
        channels: ['ticker', 'orderbook_delta', 'trade'],
        market_tickers: newTickers,
      },
    };

    this.sendMessage(message);
  }

  /**
   * Unsubscribe from a market
   */
  unsubscribeFromMarket(ticker: string): void {
    this.subscribedTickers.delete(ticker);
    this.orderbookState.delete(ticker);

    this.sendMessage({
      id: this.getNextMessageId(),
      cmd: 'unsubscribe',
      params: {
        channels: ['ticker', 'orderbook_delta', 'trade'],
        market_tickers: [ticker],
      },
    });
  }

  /**
   * Resubscribe to all markets after reconnection
   */
  private async resubscribe(): Promise<void> {
    const tickers = Array.from(this.subscribedTickers);
    wsInfo(`Resubscribing to ${tickers.length} markets`);

    // Clear old orderbook state
    this.orderbookState.clear();

    if (tickers.length > 0) {
      const message: KalshiSubscribeMessage = {
        id: this.getNextMessageId(),
        cmd: 'subscribe',
        params: {
          channels: ['ticker', 'orderbook_delta', 'trade'],
          market_tickers: tickers,
        },
      };

      this.sendMessage(message);
    }
  }

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------

  private setState(newState: WsConnectionState): void {
    const oldState = this.state;
    this.state = newState;

    if (oldState !== newState) {
      wsInfo(`State change: ${oldState} → ${newState}`);
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
        wsWarn(`WARNING: stuck in ${state} state`, {
          attempts: this.reconnectAttempts,
          lastError: this.errorMessage,
        });
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
      platform: 'kalshi',
      connectedAt: this.connectedAt?.toISOString(),
      lastMessageAt: this.lastMessageAt?.toISOString(),
      reconnectAttempts: this.reconnectAttempts,
      subscribedMarkets: this.subscribedTickers.size,
      errorMessage: this.errorMessage,
    };
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

let kalshiWsInstance: KalshiWsClient | null = null;

/**
 * Get or create the Kalshi WebSocket client singleton
 */
export function getKalshiWsClient(config?: Partial<WsClientConfig>): KalshiWsClient {
  if (!kalshiWsInstance) {
    kalshiWsInstance = new KalshiWsClient(config);
  }
  return kalshiWsInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetKalshiWsClient(): void {
  if (kalshiWsInstance) {
    kalshiWsInstance.disconnect();
    kalshiWsInstance = null;
  }
}

