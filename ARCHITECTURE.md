# AlgoBet Architecture

This document describes the live betting arbitrage system. AlgoBet is a **pure live-betting application** that detects and executes arbitrage opportunities across Kalshi, Polymarket, and SX.bet in real-time using WebSocket feeds and rule-based event matching.

---

## 1. System Overview

| Layer | Location | Responsibilities |
|-------|----------|------------------|
| **Dashboard** | `pages/`, `components/` | Next.js 14 + React UI for balances, configuration, exports, and live-arb controls. |
| **Live Arb API** | `pages/api/live-arb/**/*` | Control plane for live-arb configuration, execution mode, dry-fire stats, and status. |
| **Live Arb Worker** | `workers/live-arb-worker.ts` | Long-running process that orchestrates WebSocket connections, event registry, and arb detection. |
| **Live Sports Discovery** | `lib/live-sports-discovery*.ts` | Platform-specific logic for detecting currently-live sports events. |
| **Platform Integrations** | `lib/markets/{kalshi,polymarket,sxbet}.ts`, `services/` | REST APIs and WebSocket clients for each platform. |
| **Storage** | `lib/kv-storage.ts` | Upstash KV for runtime state, config, bets, balances, and dry-fire logs. |

---

## 2. Live Betting Architecture

### 2.1 Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **LiveArbManager** | `lib/live-arb-manager.ts` | Orchestrates WS clients, subscription management, and arb detection |
| **LivePriceCache** | `lib/live-price-cache.ts` | In-memory cache for real-time prices from WebSocket feeds |
| **LiveEventRegistry** | `lib/live-event-registry.ts` | In-memory store of vendor events from all platforms |
| **LiveEventMatcher** | `lib/live-event-matcher.ts` | Token-based matching with connected components algorithm |
| **LiveEventWatchers** | `lib/live-event-watchers.ts` | Per-event arb monitoring triggered by price updates |
| **LiveSportsOrchestrator** | `lib/live-sports-orchestrator.ts` | Main coordination module for the rule-based matcher |
| **LiveSportsDiscovery** | `lib/live-sports-discovery.ts` | Central orchestrator for platform-specific live detection |
| **LiveArbSafetyChecker** | `lib/live-arb-safety.ts` | Circuit breakers and safety checks for live execution |
| **ExecutionWrapper** | `lib/execution-wrapper.ts` | Routes between real execution and dry-fire mode |
| **DryFireLogger** | `lib/dry-fire-logger.ts` | Persistence layer for paper trade logs |

### 2.2 WebSocket Clients

Each platform has a dedicated WebSocket client with common features:
- Connection state machine: `disconnected` → `connecting` → `connected` → `reconnecting` → `error`
- Exponential backoff reconnection
- Heartbeat/ping to detect stale connections
- Subscription management with pending queue for pre-connection subscriptions

| Platform | Location | Features |
|----------|----------|----------|
| **SX.bet** | `services/sxbet-ws.ts` | Best-odds, live-scores, line-changes feeds |
| **Polymarket** | `services/polymarket-ws.ts` | Orderbook updates and last trade prices per market |
| **Kalshi** | `services/kalshi-ws.ts` | Orderbook deltas and ticker updates (RSA-PSS auth) |

---

## 3. Live Sports Discovery

The Live Sports Discovery system provides accurate detection of **currently-live** sporting events on each platform. This is critical for a pure live-betting engine.

### 3.1 Architecture

| Module | Location | Purpose |
|--------|----------|---------|
| **LiveSportsDiscovery** | `lib/live-sports-discovery.ts` | Central orchestrator, exposes `fetchPolymarketLiveMarkets()` and `fetchKalshiLiveMarkets()` |
| **PolymarketDiscovery** | `lib/live-sports-discovery-polymarket.ts` | Gamma API event_date-based discovery |
| **KalshiDiscovery** | `lib/live-sports-discovery-kalshi.ts` | Series ticker + expected_expiration_time discovery |
| **Types** | `types/live-sports-discovery.ts` | `PolymarketLiveMarket`, `KalshiLiveMarket` interfaces |

### 3.2 Polymarket Live Detection

Uses the Gamma API `/events` endpoint with `event_date` filter strategy:

**API Strategy:**
- Query `/events?event_date=YYYY-MM-DD` for today and yesterday (UTC boundary handling)
- Paginate with `offset` and `limit` parameters
- Early-stop optimization when sufficient live markets found

**Live Detection Criteria:**
1. Market has `sportsMarketType` (confirms sports market)
2. `gameStartTime` is in the past (with 15-minute future tolerance for clock skew)
3. `gameStartTime` is within the last 6 hours (game hasn't ended)
4. Market is `active=true` and `closed=false` (still tradable)

**Unreliable Indicators (NOT used):**
- `enableOrderBook` - can be false for active markets
- `acceptingOrders` - not consistently set
- `startDate`/`endDate` on parent event - too coarse

```typescript
// Example usage
import { LiveSportsDiscovery } from '@/lib/live-sports-discovery';

const liveMarkets = await LiveSportsDiscovery.fetchPolymarketLiveMarkets();
// Returns Market[] with vendorMetadata containing gameStartTime, sportsMarketType, etc.
```

### 3.3 Kalshi Live Detection

Uses the `/trade-api/v2/events` endpoint with `series_ticker` filters:

**API Strategy:**
- Query events by sports series: `KXNFL`, `KXNBA`, `KXNHL`, `KXMLB`, `KXCFB`, `KXCBB`, `KXSOCCER`
- RSA-PSS signature authentication for all requests
- Rate limiting with configurable delays between requests

**Live Detection Criteria:**
1. Parse `expected_expiration_time` from market (indicates game end time)
2. Calculate estimated start: `expected_expiration_time - sport_duration`
   - NFL/CFB: 4 hours
   - NBA/CBB/NHL: 3 hours
   - MLB: 4 hours
   - Soccer: 2.5 hours
3. Apply 30-minute buffer to both start and end times
4. Market is live if: `now > estimatedStart - buffer` AND `now < expectedEnd + buffer`

**Key Fields:**
- `expected_expiration_time` - When the game/market is expected to settle
- `series_ticker` - Sports series identifier (e.g., `KXNFL`)
- `event_ticker` - Specific game identifier

```typescript
// Example usage
import { LiveSportsDiscovery } from '@/lib/live-sports-discovery';

const liveMarkets = await LiveSportsDiscovery.fetchKalshiLiveMarkets();
// Returns Market[] with eventTicker, eventStartTime derived from expected_expiration_time
```

### 3.4 Integration with Market Fetcher

The `LiveMarketFetcher` integrates live sports discovery when `liveEventsOnly` is enabled:

```typescript
// lib/live-market-fetcher.ts
async fetchPolymarketMarkets(filters: MarketFilterInput): Promise<Market[]> {
  if (filters.liveOnly) {
    return LiveSportsDiscovery.fetchPolymarketLiveMarkets();
  }
  // ... standard fetch logic
}

async fetchKalshiMarkets(filters: MarketFilterInput): Promise<Market[]> {
  if (filters.liveOnly) {
    return LiveSportsDiscovery.fetchKalshiLiveMarkets();
  }
  // ... standard fetch logic
}
```

---

## 4. Rule-Based Live Sports Matcher

The rule-based matcher provides deterministic cross-platform event matching using token-based heuristics.

### 4.1 Token-Based Matching Algorithm

**No AI/ML, No Large Alias Maps** - Pure deterministic token overlap:

1. **Token Normalization**: Titles normalized to token arrays (stopwords removed)
2. **Sport + Time Bucketing**: Events grouped by sport and time bucket (15 min tolerance)
3. **Token Overlap Scoring**: Score `overlap`, `coverage`, and `jaccard` between token sets
4. **Connected Components**: Events with sufficient overlap form matched groups

**Key Functions (`lib/text-normalizer.ts`):**
- `normalizeEventTitle(rawTitle, opts)`: Returns `{ normalizedTitle, tokens }`
- `scoreTokenOverlap(tokensA, tokensB)`: Returns `{ overlap, coverage, jaccard }`
- `tokensMatch(tokensA, tokensB, minOverlap, minCoverage)`: Boolean match check

### 4.2 Key Types

```typescript
interface VendorEvent {
  platform: 'SXBET' | 'POLYMARKET' | 'KALSHI';
  vendorMarketId: string;
  sport: Sport;
  homeTeam?: string;
  awayTeam?: string;
  startTime?: number;
  status: 'PRE' | 'LIVE' | 'ENDED';
  rawTitle: string;
  normalizedTitle?: string;
  normalizedTokens?: string[];
}

interface MatchedEventGroup {
  eventKey: string;
  sport: Sport;
  vendors: {
    SXBET?: VendorEvent[];
    POLYMARKET?: VendorEvent[];
    KALSHI?: VendorEvent[];
  };
  platformCount: number;
  matchQuality: number;
}
```

### 4.3 Event Watchers

Watchers are event-driven and scoped:
- **Event-driven**: Triggered by `LivePriceCache` price update callbacks
- **Scoped scans**: Each watcher ONLY evaluates markets in its `MatchedEventGroup`
- **Debounced**: Rapid price updates debounced (50ms) to prevent check storms
- **Fallback polling**: 5-second safety net if WS is spotty

---

## 5. Safety Checks & Circuit Breaker

The `LiveArbSafetyChecker` provides layered protection:

| Check | Threshold | Severity |
|-------|-----------|----------|
| Price Age | `LIVE_ARB_MAX_PRICE_AGE_MS` (default 2000ms) | Critical |
| Slippage | `LIVE_ARB_MAX_SLIPPAGE_BPS` (default 100 bps) | Critical |
| Profit Margin | `LIVE_ARB_MIN_PROFIT_BPS` (default 25 bps) | Critical |
| Liquidity | `LIVE_ARB_MIN_LIQUIDITY_USD` (default $10) | Critical |
| Circuit Breaker | Open after 5 consecutive failures, 30s cooldown | Critical |

---

## 6. Dry-Fire (Paper Trading) Mode

### 6.1 Execution Mode

Stored in KV (`BotConfig.liveExecutionMode`):
- **DRY_FIRE** (default): Paper trading - detect opportunities but only log them
- **LIVE**: Execute real trades

### 6.2 Triple-Layer Protection

1. **Wrapper Layer** (`lib/execution-wrapper.ts`): Routes based on execution mode
2. **Guard Layer**: `assertNotDryFire()` throws if called in dry-fire mode
3. **Platform Layer**: Each `placeBet()` method has its own guard

---

## 7. Platform Integrations

### 7.1 Kalshi
- RSA-PSS signature authentication (`generateAuthHeaders`)
- Live sports discovery via series tickers and `expected_expiration_time`
- Order placement supports FOK limit orders

### 7.2 Polymarket
- Gamma API for event/market discovery with `event_date` filtering
- CLOB for order placement (EIP-712 signed)
- Live detection via `gameStartTime` and `sportsMarketType`

### 7.3 SX.bet
- Fetches `/markets/active` with pagination
- Hydrates odds via `/orders/odds/best`
- Full EIP-712 order signing

All integrations return the shared `Market` interface for platform-agnostic arbitrage logic.

---

## 8. Storage & Configuration

| Store | Module | Usage |
|-------|--------|-------|
| **Upstash KV** | `lib/kv-storage.ts` | Balances, configuration, bets, dry-fire logs |
| **Local JSON** | `data/*.json` | Dev defaults |
| **Event Groups** | `lib/live-event-groups-store.ts` | Matched groups persisted to disk |

### 8.1 KV-Backed Runtime Configuration

**BotConfig** (`lib/kv-storage.ts`):
- `maxBetPercentage`, `maxDaysToExpiry`, `minProfitMargin`
- `liveExecutionMode` (DRY_FIRE | LIVE)
- `marketFilters` (sports-only, categories)

**LiveArbRuntimeConfig** (`/api/live-arb/config`):
- `liveArbEnabled`: Master switch for WebSocket ingestion + execution
- `ruleBasedMatcherEnabled`: Controls the rule-based matcher
- `sportsOnly`: Filters registry to sports markets only
- `liveEventsOnly`: **Critical** - triggers Live Sports Discovery for accurate live detection

---

## 9. API Surface

### 9.1 Live Arb Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/live-arb/status` | Overall status, WS connections, cache stats |
| `GET/POST /api/live-arb/config` | Read/write runtime configuration |
| `GET/POST /api/live-arb/execution-mode` | Read/write execution mode |
| `GET /api/live-arb/live-events` | Registry snapshot, matched groups |
| `GET /api/live-arb/dry-fire-stats` | Aggregated dry-fire statistics |

### 9.2 Dashboard Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/balances`, `/api/balances/refresh` | Cached balances + refresh |
| `/api/bets`, `/api/opportunity-logs` | Trade and opportunity reporting |
| `/api/config` | Bot configuration |
| `/api/health` | Health check |

---

## 10. Live Arb Worker

The main entry point for live betting. Run via `npm run live-arb-worker`.

**Boot sequence:**
1. Load `BotConfig` + live-arb runtime config from KV
2. Exit if `liveArbEnabled=false`
3. Initialize `LiveArbManager` with WS clients
4. Start `LiveSportsOrchestrator`
5. Begin market refresh loop

**Market Refresh Loop (every 15s):**
1. Reload `LiveArbRuntimeConfig`
2. Build filters from config
3. If `liveEventsOnly=true`: Use Live Sports Discovery for accurate live detection
4. Otherwise: Standard market fetch with expiry-based filtering
5. Update registry via `refreshRegistry()`

**Heartbeat Reporting:**
Worker calls `updateWorkerHeartbeat()` (KV) after startup, each refresh, and shutdown.

---

## 11. Environment Variables

**No boolean env flags for features** - all toggles via KV configuration.

### Required Credentials

| Variable | Description |
|----------|-------------|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis |
| `KALSHI_API_KEY`, `KALSHI_PRIVATE_KEY` | Kalshi API (RSA-PSS) |
| `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_PRIVATE_KEY` | Polymarket CLOB |
| `SXBET_API_KEY`, `SXBET_PRIVATE_KEY`, `SXBET_WALLET_ADDRESS` | SX.bet |

### Optional Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVE_ARB_MIN_PROFIT_BPS` | `50` | Minimum profit (basis points) |
| `LIVE_ARB_MAX_PRICE_AGE_MS` | `2000` | Max acceptable price age |
| `LIVE_ARB_WORKER_REFRESH_MS` | `15000` | Market refresh interval |
| `KALSHI_WS_URL` | `wss://api.elections.kalshi.com/trade-api/ws/v2` | Kalshi WebSocket |
| `POLYMARKET_WS_URL` | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | Polymarket WS |

---

## 12. Testing

| Script | Purpose |
|--------|---------|
| `npm run test-live-arb` | Test LivePriceCache, safety checks |
| `npm run test-live-events` | Test token normalization, matching, registry |
| `npm run test-live-ws-connections` | Test WebSocket connections |
| `npm run test:kalshi-live` | Test Kalshi live sports discovery |
| `npm run test:poly-live` | Test Polymarket live sports discovery |
| `npm run test:live-sports` | Test both platform discoveries |

---

## 13. Deployment & Operations

### Running the Live Arb Worker

```bash
# Development
npm run live-arb-worker

# Production (PM2)
pm2 start npm --name "live-arb-worker" -- run live-arb-worker
```

### Enabling Live Arbitrage

1. Configure platform API credentials
2. Navigate to `/live-arb` dashboard
3. Enable "Live Arb Enabled" and "Rule-Based Matcher"
4. Enable "Live Events Only" for pure live-betting mode
5. Start the live-arb-worker process

### Going from Paper Trading to Live

1. Monitor dry-fire logs to validate opportunity detection
2. Review rejection reasons and tune thresholds
3. Change Execution Mode to "LIVE" via dashboard
4. Monitor `/api/live-arb/status` for results

---

## 14. Future Work

- **Distributed price cache**: Redis pub/sub for multi-container deployments
- **Additional WS platforms**: Extensible WS client pattern
- **Dry-fire analytics**: Time-series analysis of paper trades
- **Sport-specific matching**: Customize matching logic per sport
- **SX.bet live discovery**: Add live sports detection for SX.bet platform
