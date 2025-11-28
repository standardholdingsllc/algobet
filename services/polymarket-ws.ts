/**
 * Polymarket WebSocket Client
 *
 * Connects to Polymarket CLOB WebSocket for:
 * - Real-time orderbook updates
 * - Trade notifications
 * - Price streaming
 *
 * Based on Polymarket CLOB docs: https://docs.polymarket.com/developers/CLOB/introduction
 *
 * Note: Polymarket is price-only (no live scores).
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

// ============================================================================
// Polymarket WebSocket Message Types
// ============================================================================

interface PolymarketWsMessage {
  type?: string;
  event?: string;
  channel?: string;
  data?: any;
  market?: string;
  asset_id?: string;
}

interface PolymarketBookUpdate {
  market?: string;
  asset_id?: string;
  hash?: string;
  timestamp?: string;
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
}

interface PolymarketPriceUpdate {
  market?: string;
  asset_id?: string;
  price?: string;
  timestamp?: string;
}

interface PolymarketTradeUpdate {
  market?: string;
  asset_id?: string;
  price?: string;
  size?: string;
  side?: 'BUY' | 'SELL';
  timestamp?: string;
}

// ============================================================================
// Polymarket WebSocket Client
// ============================================================================

export class PolymarketWsClient {
  private ws: WebSocket | null = null;
  private config: WsClientConfig;
  private state: WsConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private connectedAt?: Date;
  private lastMessageAt?: Date;
  private subscribedAssets: Set<string> = new Set();
  private stateHandlers: Set<WsStateHandler> = new Set();
  private errorMessage?: string;

  private readonly wsUrl: string;

  constructor(config?: Partial<WsClientConfig>) {
    this.config = { ...DEFAULT_WS_CONFIG, ...config };
    // Polymarket CLOB WebSocket URL
    this.wsUrl = process.env.POLYMARKET_WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
  }

  // --------------------------------------------------------------------------
  // Connection Management
  // --------------------------------------------------------------------------

  /**
   * Connect to Polymarket WebSocket
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      console.log('[PolymarketWs] Already connected or connecting');
      return;
    }

    this.setState('connecting');
    console.log(`[PolymarketWs] Connecting to ${this.wsUrl}...`);

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
          console.log('[PolymarketWs] ✅ Connected successfully');

          // Start heartbeat
          this.startHeartbeat();

          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error: Error) => {
          clearTimeout(timeout);
          console.error('[PolymarketWs] WebSocket error:', error.message);
          this.errorMessage = error.message;
          if (this.state === 'connecting') {
            reject(error);
          }
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          clearTimeout(timeout);
          console.log(`[PolymarketWs] Connection closed: ${code} - ${reason.toString()}`);
          this.stopHeartbeat();
          this.handleDisconnect();
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
    console.log('[PolymarketWs] Disconnecting...');
    this.stopReconnectTimer();
    this.stopHeartbeat();
    this.subscribedAssets.clear();

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
      console.error(
        `[PolymarketWs] Max reconnection attempts (${this.config.maxReconnectAttempts}) reached`
      );
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

    console.log(
      `[PolymarketWs] Scheduling reconnect attempt ${this.reconnectAttempts + 1} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
        await this.resubscribe();
      } catch (error) {
        console.error('[PolymarketWs] Reconnection failed:', error);
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
        // Polymarket uses standard ping frames or custom ping messages
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

  private sendMessage(message: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    this.lastMessageAt = new Date();

    try {
      const message: PolymarketWsMessage = JSON.parse(data.toString());
      const eventType = message.type || message.event;

      switch (eventType) {
        case 'book':
        case 'orderbook':
        case 'book_update':
          this.handleBookUpdate(message.data || message);
          break;

        case 'price':
        case 'price_update':
          this.handlePriceUpdate(message.data || message);
          break;

        case 'trade':
        case 'last_trade_price':
          this.handleTradeUpdate(message.data || message);
          break;

        case 'subscribed':
          console.log(
            `[PolymarketWs] Subscribed to ${message.market || message.asset_id}`
          );
          break;

        case 'error':
          console.error('[PolymarketWs] Server error:', message.data);
          break;

        case 'pong':
          // Heartbeat response
          break;

        default:
          // Attempt to parse as book/price update if no type specified
          if (message.bids || message.asks) {
            this.handleBookUpdate(message);
          } else if (message.price) {
            this.handlePriceUpdate(message);
          }
      }
    } catch (error) {
      console.error('[PolymarketWs] Failed to parse message:', error);
    }
  }

  /**
   * Handle orderbook updates
   */
  private handleBookUpdate(data: PolymarketBookUpdate): void {
    const marketId = data.market || data.asset_id || data.hash;
    if (!marketId) return;

    // Extract best bid and ask
    const bestBid =
      data.bids && data.bids.length > 0
        ? parseFloat(data.bids[0].price)
        : null;
    const bestAsk =
      data.asks && data.asks.length > 0
        ? parseFloat(data.asks[0].price)
        : null;

    // Use mid-price if both bid and ask are available
    let price: number | null = null;
    if (bestBid !== null && bestAsk !== null) {
      price = (bestBid + bestAsk) / 2;
    } else if (bestBid !== null) {
      price = bestBid;
    } else if (bestAsk !== null) {
      price = bestAsk;
    }

    if (price !== null) {
      // Polymarket prices are typically in 0-1 range, convert to cents
      const priceInCents = price * 100;

      // Update YES side
      const yesUpdate: LivePriceUpdate = {
        key: {
          platform: 'polymarket',
          marketId,
          outcomeId: 'yes',
        },
        price: priceInCents,
        impliedProbability: price,
        source: 'websocket',
        meta: {
          bestBid: bestBid ? bestBid * 100 : undefined,
          bestAsk: bestAsk ? bestAsk * 100 : undefined,
          spread:
            bestBid !== null && bestAsk !== null
              ? (bestAsk - bestBid) * 100
              : undefined,
        },
      };
      LivePriceCache.updateLivePrice(yesUpdate);

      // Update NO side (complement)
      const noUpdate: LivePriceUpdate = {
        key: {
          platform: 'polymarket',
          marketId,
          outcomeId: 'no',
        },
        price: 100 - priceInCents,
        impliedProbability: 1 - price,
        source: 'websocket',
      };
      LivePriceCache.updateLivePrice(noUpdate);
    }
  }

  /**
   * Handle price updates
   */
  private handlePriceUpdate(data: PolymarketPriceUpdate): void {
    const marketId = data.market || data.asset_id;
    if (!marketId || !data.price) return;

    const price = parseFloat(data.price);
    if (isNaN(price)) return;

    // Polymarket prices are typically 0-1, convert to cents
    const priceInCents = price <= 1 ? price * 100 : price;

    // Update YES side
    LivePriceCache.updateLivePrice({
      key: {
        platform: 'polymarket',
        marketId,
        outcomeId: 'yes',
      },
      price: priceInCents,
      impliedProbability: priceInCents / 100,
      source: 'websocket',
    });

    // Update NO side
    LivePriceCache.updateLivePrice({
      key: {
        platform: 'polymarket',
        marketId,
        outcomeId: 'no',
      },
      price: 100 - priceInCents,
      impliedProbability: 1 - priceInCents / 100,
      source: 'websocket',
    });
  }

  /**
   * Handle trade updates (last trade price)
   */
  private handleTradeUpdate(data: PolymarketTradeUpdate): void {
    // Trade updates can be used to update last known price
    if (data.price) {
      this.handlePriceUpdate(data as PolymarketPriceUpdate);
    }
  }

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  /**
   * Subscribe to orderbook updates for a market
   * @param assetId The token/asset ID (condition_id or token_id)
   */
  subscribeToMarket(assetId: string): void {
    if (this.subscribedAssets.has(assetId)) {
      return;
    }

    this.subscribedAssets.add(assetId);

    // Polymarket CLOB subscription format
    this.sendMessage({
      type: 'subscribe',
      channel: 'book',
      market: assetId,
    });

    // Also subscribe to last trade price
    this.sendMessage({
      type: 'subscribe',
      channel: 'last_trade_price',
      market: assetId,
    });
  }

  /**
   * Subscribe to multiple markets
   */
  subscribeToMarkets(assetIds: string[]): void {
    for (const id of assetIds) {
      this.subscribeToMarket(id);
    }
  }

  /**
   * Unsubscribe from a market
   */
  unsubscribeFromMarket(assetId: string): void {
    this.subscribedAssets.delete(assetId);
    this.sendMessage({
      type: 'unsubscribe',
      channel: 'book',
      market: assetId,
    });
  }

  /**
   * Resubscribe to all markets after reconnection
   */
  private async resubscribe(): Promise<void> {
    const assets = Array.from(this.subscribedAssets);
    console.log(`[PolymarketWs] Resubscribing to ${assets.length} markets`);

    for (const asset of assets) {
      this.subscribeToMarket(asset);
    }
  }

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------

  private setState(newState: WsConnectionState): void {
    const oldState = this.state;
    this.state = newState;

    if (oldState !== newState) {
      console.log(`[PolymarketWs] State: ${oldState} → ${newState}`);
      this.notifyStateChange();
    }
  }

  private notifyStateChange(): void {
    const status = this.getStatus();
    for (const handler of this.stateHandlers) {
      try {
        handler(status);
      } catch (error) {
        console.error('[PolymarketWs] Error in state handler:', error);
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
      platform: 'polymarket',
      connectedAt: this.connectedAt?.toISOString(),
      lastMessageAt: this.lastMessageAt?.toISOString(),
      reconnectAttempts: this.reconnectAttempts,
      subscribedMarkets: this.subscribedAssets.size,
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

let polymarketWsInstance: PolymarketWsClient | null = null;

/**
 * Get or create the Polymarket WebSocket client singleton
 */
export function getPolymarketWsClient(
  config?: Partial<WsClientConfig>
): PolymarketWsClient {
  if (!polymarketWsInstance) {
    polymarketWsInstance = new PolymarketWsClient(config);
  }
  return polymarketWsInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetPolymarketWsClient(): void {
  if (polymarketWsInstance) {
    polymarketWsInstance.disconnect();
    polymarketWsInstance = null;
  }
}

