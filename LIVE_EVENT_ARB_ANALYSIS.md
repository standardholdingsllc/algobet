# Live-Event Arbitrage Analysis

## Executive Summary

This document analyzes the feasibility of implementing live-event arbitrage across Polymarket, Kalshi, and SX.bet using the existing AlgoBet codebase. Based on extensive analysis of the codebase architecture and API documentation, **live-event arbitrage is feasible but requires significant enhancements**, primarily around real-time data feeds and in-play execution.

**Verdict: FEASIBLE with moderate-to-high effort**

---

## 1. Current Codebase Capabilities

### 1.1 What Already Exists

| Component | Status | Location |
|-----------|--------|----------|
| **Kalshi Integration** | ✅ Complete | `lib/markets/kalshi.ts` |
| **Polymarket Integration** | ✅ Complete | `lib/markets/polymarket.ts` |
| **SX.bet Integration** | ⚠️ Partial | `lib/markets/sxbet.ts` |
| **Cross-Platform Matching** | ✅ Complete | `lib/market-matching.ts` |
| **Hot Market Tracker** | ✅ Complete | `lib/hot-market-tracker.ts` |
| **Adaptive Scanner** | ✅ Complete | `lib/adaptive-scanner.ts` |
| **Arbitrage Detection** | ✅ Complete | `lib/arbitrage.ts` |
| **Fee Calculations** | ✅ Complete | `lib/fees.ts` |
| **Order Placement (Kalshi)** | ✅ Complete | RSA-PSS signed orders |
| **Order Placement (Polymarket)** | ⚠️ Partial | EIP-712 CLOB orders |
| **Order Placement (SX.bet)** | ❌ TODO | Needs EIP-712 signing |
| **WebSocket Connections** | ❌ Missing | Only REST polling exists |
| **Live Score Tracking** | ❌ Missing | Not implemented |

### 1.2 Current Architecture Highlights

```
┌─────────────────────────────────────────────────────────────┐
│                     AlgoBet Architecture                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │    Kalshi    │    │  Polymarket  │    │    SX.bet    │  │
│  │   REST API   │    │ CLOB/Gamma   │    │   REST API   │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │          │
│         └─────────┬─────────┴─────────┬─────────┘          │
│                   │                   │                     │
│         ┌─────────▼─────────┐        │                     │
│         │  Snapshot Worker  │        │                     │
│         │  (20s refresh)    │        │                     │
│         └─────────┬─────────┘        │                     │
│                   │                   │                     │
│         ┌─────────▼─────────┐        │                     │
│         │   Bot Engine      │◄───────┘                     │
│         │ (5-60s adaptive)  │                              │
│         └─────────┬─────────┘                              │
│                   │                                         │
│         ┌─────────▼─────────┐                              │
│         │ Hot Market Tracker│                              │
│         │ + Arb Detection   │                              │
│         └─────────┬─────────┘                              │
│                   │                                         │
│         ┌─────────▼─────────┐                              │
│         │   Order Executor  │                              │
│         │ (Fill-or-Kill)    │                              │
│         └───────────────────┘                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Current Limitation:** The system polls REST APIs every 5-60 seconds. Live-event arbitrage requires sub-second data for optimal execution.

---

## 2. API Documentation Analysis

### 2.1 Polymarket API

**Source:** [docs.polymarket.com/developers/CLOB/introduction](https://docs.polymarket.com/developers/CLOB/introduction)

| Feature | Support | Notes |
|---------|---------|-------|
| REST API | ✅ | Markets, orderbook, orders |
| WebSocket API | ✅ | Real-time orderbook updates |
| Order Types | Limit | EIP-712 signed messages |
| Fees | 0% | Both maker and taker (current schedule) |
| Settlement | On-chain | Polygon, non-custodial |
| Live Sports | ⚠️ Limited | Some sports markets exist |

**Key WebSocket Endpoints (from CLOB docs):**
- Real-time order book updates
- Trade notifications
- Market price streaming

**For Live-Event Arb:**
- Polymarket is primarily prediction markets (elections, economic events)
- Sports markets exist but are less common
- WebSocket can provide near-instant price updates
- Best used as the "slow" side of an arb (prices may lag live action)

### 2.2 Kalshi API

**Source:** [docs.kalshi.com/welcome](https://docs.kalshi.com/welcome)

| Feature | Support | Notes |
|---------|---------|-------|
| REST API | ✅ | Full trading functionality |
| WebSocket API | ✅ | Market data streaming |
| Order Types | Limit, Market | FOK support |
| Fees | Variable | 0.035-0.07 × C × P × (1-P) |
| Settlement | Regulated | CFTC-regulated exchange |
| Live Sports | ❌ | Focus on events/politics |

**Key WebSocket Capabilities:**
- Real-time market data
- Order status updates
- Price changes

**For Live-Event Arb:**
- Kalshi focuses on event outcomes (will X happen by date Y?)
- Markets typically close before the event resolves
- Less suitable for in-play sports arbitrage
- Better for pre-event arb windows

### 2.3 SX.bet API

**Source:** [api.docs.sx.bet/#introduction](https://api.docs.sx.bet/#introduction)

| Feature | Support | Notes |
|---------|---------|-------|
| REST API | ✅ | Markets, orders, trades |
| WebSocket API | ✅ | **Comprehensive real-time data** |
| Order Types | Limit | EIP-712 signed |
| Fees | **0%** | Both maker and taker |
| Settlement | On-chain | SX Network L2 |
| Live Sports | ✅ **Full** | Designed for in-play |

**Critical WebSocket Endpoints:**

```javascript
// From SX.bet API docs
{
  "Websocket API": {
    "Initialization": "Connect and authenticate",
    "Market updates": "Real-time market changes",
    "Line changes": "Odds movement tracking",     // KEY FOR ARB
    "Live score updates": "In-game scores",       // KEY FOR ARB
    "Trade updates": "Fill notifications",
    "Order book updates": "Bid/ask changes",
    "Best odds": "Top of book streaming",         // KEY FOR ARB
    "Active order updates": "Your order status",
    "CE refund events": "Capital efficiency"
  }
}
```

**For Live-Event Arb:**
- **BEST PLATFORM** for live-event arbitrage
- Full in-play sports betting support
- Real-time line movements (odds changes)
- Live score integration
- 0% fees maximize arb profits
- WebSocket provides sub-second updates

---

## 3. Live-Event Arbitrage Viability Assessment

### 3.1 Cross-Platform Opportunity Matrix

| Platform A | Platform B | Live Sports Overlap | Latency Match | Viability |
|------------|------------|---------------------|---------------|-----------|
| Polymarket | Kalshi | Low | Good | ⚠️ Pre-event only |
| Polymarket | SX.bet | Medium | Risky | ⚠️ Need fast PM data |
| Kalshi | SX.bet | Low | Risky | ⚠️ Limited overlap |
| SX.bet | DraftKings* | High | Good | ✅ Future expansion |

*DraftKings example for future platform expansion

### 3.2 The Live-Event Arb Strategy

**Primary Strategy: SX.bet vs Prediction Markets**

```
┌────────────────────────────────────────────────────────────┐
│                  Live-Event Arb Flow                        │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  1. PRE-GAME MATCH                                          │
│     ┌──────────┐     ┌──────────┐     ┌──────────┐        │
│     │  Kalshi  │────▶│  Match   │◀────│  SX.bet  │        │
│     │ "Lakers  │     │ Engine   │     │ Lakers   │        │
│     │  Win?"   │     │          │     │ vs Celts │        │
│     └──────────┘     └──────────┘     └──────────┘        │
│                             │                              │
│  2. LIVE MONITORING (GAME START)                           │
│     ┌──────────────────────┐                               │
│     │ SX.bet WebSocket     │                               │
│     │ • Live scores        │                               │
│     │ • Odds movements     │──────▶ Arb Detector          │
│     │ • Best odds stream   │                               │
│     └──────────────────────┘                               │
│                                                             │
│  3. OPPORTUNITY DETECTED                                    │
│     SX.bet: Lakers -150 (40% implied)                      │
│     Kalshi: Lakers YES @ 35¢                               │
│     ▶ Combined: 75% coverage, 25%+ arb potential           │
│                                                             │
│  4. INSTANT EXECUTION                                       │
│     ┌────────────┐     ┌────────────┐                      │
│     │ Place YES  │     │ Bet NO on  │                      │
│     │ on Kalshi  │────▶│ SX.bet     │                      │
│     │ @ 35¢      │     │ @ +150     │                      │
│     └────────────┘     └────────────┘                      │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### 3.3 Key Challenges

| Challenge | Severity | Mitigation |
|-----------|----------|------------|
| **Latency** | High | WebSocket for SX.bet + fast polling for others |
| **Market Overlap** | Medium | Focus on major events with cross-platform coverage |
| **Odds Stale-ness** | High | Track last update timestamp, reject stale prices |
| **Execution Risk** | High | Fill-or-Kill, atomic execution where possible |
| **Capital Lockup** | Medium | SX.bet Capital Efficiency helps |
| **API Rate Limits** | Medium | WebSocket reduces REST calls |

---

## 4. Required Development Work

### 4.1 Phase 1: Real-Time Data Infrastructure (Priority: CRITICAL)

#### Task 1.1: SX.bet WebSocket Client
**Effort:** 2-3 days | **Priority:** P0

```typescript
// lib/websocket/sxbet-ws.ts
interface SXBetWebSocketClient {
  // Connection management
  connect(): Promise<void>;
  disconnect(): void;
  reconnect(): Promise<void>;
  
  // Subscriptions
  subscribeToMarket(marketHash: string): void;
  subscribeToBestOdds(marketHashes: string[]): void;
  subscribeToLiveScores(fixtureIds: string[]): void;
  subscribeToLineChanges(): void;
  
  // Event handlers
  onOddsUpdate(handler: (update: OddsUpdate) => void): void;
  onScoreUpdate(handler: (update: ScoreUpdate) => void): void;
  onOrderBookUpdate(handler: (update: OrderBookUpdate) => void): void;
  
  // Heartbeat
  registerHeartbeat(interval: number): void;
}
```

**Implementation Notes:**
- Based on `scripts/test-sxbet-websocket.js` foundation
- Add reconnection logic with exponential backoff
- Implement heartbeat per API docs
- Add message queue for burst handling

#### Task 1.2: Polymarket WebSocket Client
**Effort:** 1-2 days | **Priority:** P1

```typescript
// lib/websocket/polymarket-ws.ts
interface PolymarketWebSocketClient {
  connect(): Promise<void>;
  subscribeToOrderBook(conditionId: string): void;
  onPriceUpdate(handler: (update: PriceUpdate) => void): void;
}
```

#### Task 1.3: Unified Real-Time Feed
**Effort:** 2 days | **Priority:** P0

```typescript
// lib/realtime/unified-feed.ts
interface UnifiedMarketFeed {
  // Combines all WebSocket feeds into normalized stream
  subscribe(marketIds: CrossPlatformMarket[]): void;
  onArbOpportunity(handler: (opp: LiveArbOpportunity) => void): void;
  getLatestPrices(): Map<string, PriceSnapshot>;
}
```

### 4.2 Phase 2: Live Arbitrage Engine (Priority: HIGH)

#### Task 2.1: Live Arb Detector
**Effort:** 2-3 days | **Priority:** P0

```typescript
// lib/live-arb-detector.ts
interface LiveArbDetector {
  // Runs on every price update (not polling-based)
  checkForArbitrage(
    priceUpdate: PriceUpdate,
    allPrices: Map<string, PriceSnapshot>
  ): LiveArbOpportunity | null;
  
  // Validates opportunity is still valid
  validateOpportunity(opp: LiveArbOpportunity): boolean;
  
  // Calculates optimal bet sizing
  calculateBetSizes(
    opp: LiveArbOpportunity,
    balances: PlatformBalances
  ): BetSizing;
}
```

**Key Differences from Current System:**
- Event-driven (not poll-based)
- Sub-second opportunity detection
- Price staleness checks (reject if >2 seconds old)
- Faster validation cycle

#### Task 2.2: Live Score Integration
**Effort:** 1-2 days | **Priority:** P1

```typescript
// lib/live-scores.ts
interface LiveScoreTracker {
  // Track game state for context
  getCurrentScore(fixtureId: string): GameScore;
  getGamePhase(fixtureId: string): 'pre' | 'live' | 'halftime' | 'ended';
  
  // Estimate implied probability based on score
  estimateImpliedOdds(fixtureId: string, outcome: string): number;
}
```

**Why This Matters:**
- During live games, odds should reflect current score
- Stale odds (not reflecting recent score) = arb opportunity
- Score context helps validate opportunities

### 4.3 Phase 3: In-Play Execution (Priority: HIGH)

#### Task 3.1: Complete SX.bet EIP-712 Signing
**Effort:** 2-3 days | **Priority:** P0

The current `lib/markets/sxbet.ts` has this stub:

```typescript
// Current state (incomplete)
async placeBet(...): Promise<...> {
  console.warn('sx.bet betting not fully implemented - requires EIP712 signing');
  return { success: false, error: 'Not implemented' };
}
```

**Required Implementation:**

```typescript
// lib/markets/sxbet.ts - Enhanced
import { signTypedData, SignTypedDataVersion } from "@metamask/eth-sig-util";

async placeBet(
  marketHash: string,
  side: 'yes' | 'no',
  odds: number,
  stake: number
): Promise<ExecutionResult> {
  // 1. Build order payload per SX.bet spec
  const order = this.buildOrderPayload(marketHash, side, odds, stake);
  
  // 2. Sign with EIP-712
  const signature = signTypedData({
    privateKey: Buffer.from(this.privateKey.slice(2), 'hex'),
    data: this.buildEIP712Payload(order),
    version: SignTypedDataVersion.V4,
  });
  
  // 3. Submit to SX.bet
  const response = await this.submitOrder(order, signature);
  
  return response;
}
```

#### Task 3.2: Atomic Execution Coordinator
**Effort:** 2-3 days | **Priority:** P0

```typescript
// lib/execution/atomic-executor.ts
interface AtomicExecutor {
  // Execute both legs simultaneously
  executeArbitrage(
    opp: LiveArbOpportunity,
    sizing: BetSizing
  ): Promise<ExecutionResult>;
  
  // Handle partial fills
  handlePartialFill(result: ExecutionResult): Promise<void>;
  
  // Emergency cancel
  cancelPendingOrders(): Promise<void>;
}
```

**Critical Considerations:**
- If one leg fails, cancel the other immediately
- Track execution latency for each platform
- Implement timeout handling (e.g., 5 second max wait)

### 4.4 Phase 4: Monitoring & Safety (Priority: MEDIUM)

#### Task 4.1: Live Dashboard Enhancements
**Effort:** 1-2 days | **Priority:** P2

```typescript
// components/LiveArbMonitor.tsx
// Real-time display of:
// - Active WebSocket connections
// - Live odds across platforms
// - Current arb opportunities
// - Execution history
// - Latency metrics
```

#### Task 4.2: Circuit Breakers
**Effort:** 1 day | **Priority:** P1

```typescript
// lib/safety/circuit-breakers.ts
interface CircuitBreaker {
  // Stop trading if:
  checkMaxLoss(totalLoss: number): boolean;  // Loss limit hit
  checkLatency(latencyMs: number): boolean;  // Latency too high
  checkStalePrices(age: number): boolean;    // Data too old
  checkRapidFails(failCount: number): boolean; // Too many failures
}
```

---

## 5. Implementation Roadmap

### Week 1-2: Foundation
| Day | Task | Deliverable |
|-----|------|-------------|
| 1-2 | SX.bet WebSocket client | Working connection + basic subscriptions |
| 3-4 | SX.bet WebSocket handlers | Odds, scores, orderbook events |
| 5 | Complete SX.bet EIP-712 | Working order placement |
| 6-7 | Polymarket WebSocket | Basic price streaming |
| 8-9 | Unified feed service | Normalized cross-platform stream |
| 10 | Integration testing | End-to-end WebSocket test |

### Week 3: Live Arb Engine
| Day | Task | Deliverable |
|-----|------|-------------|
| 11-12 | Live arb detector | Event-driven opportunity detection |
| 13 | Price staleness logic | Reject stale opportunities |
| 14-15 | Atomic executor | Simultaneous leg execution |

### Week 4: Polish & Deploy
| Day | Task | Deliverable |
|-----|------|-------------|
| 16-17 | Circuit breakers | Safety mechanisms |
| 18 | Live dashboard | Real-time monitoring UI |
| 19-20 | Testing & hardening | Production readiness |

---

## 6. Technical Specifications

### 6.1 New Dependencies Required

```json
{
  "dependencies": {
    "ws": "^8.14.0",
    "@metamask/eth-sig-util": "^7.0.0",
    "reconnecting-websocket": "^4.4.0"
  }
}
```

### 6.2 Environment Variables

```bash
# Add to .env
SXBET_WS_URL=wss://api.sx.bet
POLYMARKET_WS_URL=wss://clob.polymarket.com

# Live arb numeric tuning (enablement now lives in /api/live-arb/config)
LIVE_ARB_MIN_PROFIT_BPS=50  # 0.5% minimum
LIVE_ARB_MAX_LATENCY_MS=2000
LIVE_ARB_MAX_PRICE_AGE_MS=2000
```

### 6.3 New File Structure

```
lib/
├── websocket/
│   ├── base-ws-client.ts       # Abstract WebSocket client
│   ├── sxbet-ws.ts             # SX.bet WebSocket
│   ├── polymarket-ws.ts        # Polymarket WebSocket
│   └── connection-manager.ts   # Reconnection logic
├── realtime/
│   ├── unified-feed.ts         # Combined market feed
│   ├── price-cache.ts          # Latest prices
│   └── staleness-checker.ts    # Price freshness
├── live-arb/
│   ├── detector.ts             # Live opportunity detection
│   ├── validator.ts            # Opportunity validation
│   └── executor.ts             # Order execution
└── safety/
    ├── circuit-breakers.ts     # Trading safeguards
    └── latency-monitor.ts      # Performance tracking
```

---

## 7. Risk Assessment

### 7.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| WebSocket disconnections | High | Medium | Auto-reconnect with backoff |
| Price staleness | High | High | Strict timestamp validation |
| Execution latency | Medium | High | Pre-positioned orders where possible |
| API rate limits | Medium | Medium | WebSocket reduces REST dependency |
| Partial fills | Medium | High | Atomic execution or full cancel |

### 7.2 Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Low cross-platform overlap | Medium | High | Focus on major events |
| Thin liquidity | Medium | Medium | Size orders appropriately |
| Platform downtime | Low | High | Graceful degradation |
| Fee changes | Low | Medium | Monitor fee announcements |

---

## 8. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| WebSocket uptime | >99.5% | Connection monitoring |
| Price latency (SX.bet) | <500ms | Timestamp delta |
| Opportunity detection | <100ms | Time from update to alert |
| Execution latency | <2s | Order to fill |
| Daily arb opportunities | >10 | Opportunity log count |
| Profitable trades | >80% | Trade P&L tracking |

---

## 9. Conclusion

### Feasibility: ✅ YES

Live-event arbitrage is feasible using the existing codebase with the following enhancements:

1. **Critical Path:**
   - SX.bet WebSocket integration (real-time odds)
   - Complete SX.bet order execution (EIP-712)
   - Event-driven arbitrage detection

2. **Primary Opportunity:**
   - SX.bet (live sports, 0% fees, WebSocket) ↔ Polymarket/Kalshi (prediction markets)
   - Focus on major sporting events with cross-platform coverage

3. **Estimated Effort:**
   - 15-20 developer days for MVP
   - 4-week timeline with testing

4. **Key Advantage:**
   - Your existing architecture (hot market tracker, market matching, adaptive scanner) provides a solid foundation
   - Fee calculations and risk management already implemented
   - Only real-time data layer and execution completion needed

### Recommended Next Steps

1. **Immediate:** Complete SX.bet EIP-712 order signing
2. **Week 1:** Build SX.bet WebSocket client with live odds streaming
3. **Week 2:** Implement event-driven arbitrage detection
4. **Week 3:** Integrate with existing bot engine
5. **Week 4:** Testing and production hardening

---

## References

- [Polymarket CLOB Documentation](https://docs.polymarket.com/developers/CLOB/introduction)
- [Kalshi API Documentation](https://docs.kalshi.com/welcome)
- [SX.bet API Documentation](https://api.docs.sx.bet/#introduction)
- AlgoBet Architecture: `ARCHITECTURE.md`
- Existing SX.bet WebSocket test: `scripts/test-sxbet-websocket.js`

