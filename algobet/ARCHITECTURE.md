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
| **LiveEventMatcher** | `lib/live-event-matcher.ts` | Fuzzy matchupKey-based matching with connected components algorithm |
| **LiveEventWatchers** | `lib/live-event-watchers.ts` | Per-event arb monitoring triggered by price updates |
| **LiveSportsOrchestrator** | `lib/live-sports-orchestrator.ts` | Main coordination module for the rule-based matcher |
| **LiveSportsDiscovery** | `lib/live-sports-discovery.ts` | Central orchestrator for platform-specific live detection |
| **LiveArbSafetyChecker** | `lib/live-arb-safety.ts` | Circuit breakers and safety checks for live execution |
| **ExecutionWrapper** | `lib/execution-wrapper.ts` | Routes between real execution and dry-fire mode |
| **DryFireLogger** | `lib/dry-fire-logger.ts` | Persistence layer for paper trade logs |
| **LatencyTracker** | `lib/latency-tracker.ts` | Tracks WebSocket latency and publishes stats to KV |

### 2.2 WebSocket Clients

Each platform has a dedicated WebSocket client with common features:
- Connection state machine: `disconnected` → `connecting` → `connected` → `reconnecting` → `error`
- Exponential backoff reconnection
- Heartbeat/ping to detect stale connections
- Subscription management with pending queue for pre-connection subscriptions

| Platform | Location | Features |
|----------|----------|----------|
| **SX.bet** | `services/sxbet-ws.ts` | Ably-based WebSocket with best-odds, live-scores, line-changes feeds |
| **Polymarket** | `services/polymarket-ws.ts` | Orderbook updates and last trade prices per market |
| **Kalshi** | `services/kalshi-ws.ts` | Orderbook deltas and ticker updates (RSA-PSS auth) |

### 2.3 Price Cache Architecture

The `LivePriceCache` is an in-memory, per-process cache that:

- Stores prices normalized to implied probability [0,1]
- Handles platform-specific price formats:
  - Kalshi/Polymarket: cents (0-100) → probability (0-1)
  - SX.bet: decimal odds → probability = 1/odds
- Computes price age for staleness detection
- Supports both live WebSocket prices and REST snapshot fallback
- Publishes statistics to handlers for monitoring

**Multi-Process Behavior**: This cache is per-process. For distributed deployments, a dedicated live-arb worker process handles all WS connections.

---

## 3. Live Sports Discovery

The Live Sports Discovery system provides accurate detection of **currently-live** sporting events on each platform.

### 3.1 Architecture

| Module | Location | Purpose |
|--------|----------|---------|
| **LiveSportsDiscovery** | `lib/live-sports-discovery.ts` | Central orchestrator, converts results to VendorEvents |
| **PolymarketDiscovery** | `lib/live-sports-discovery-polymarket.ts` | Gamma API event_date-based discovery |
| **KalshiDiscovery** | `lib/live-sports-discovery-kalshi.ts` | Series ticker + expected_expiration_time discovery |
| **SXBetDiscovery** | `lib/live-sports-discovery-sxbet.ts` | /markets/active?liveOnly=true with odds hydration |
| **Types** | `types/live-sports-discovery.ts` | `PolymarketLiveMarket`, `KalshiLiveEvent`, `SXBetLiveMarket` interfaces |

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

**Odds Seeding:**
- Discovered markets have their prices seeded to `LivePriceCache`
- Enables immediate arb detection without waiting for WS updates

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

### 3.4 SX.bet Live Detection

Uses the `/markets/active` endpoint with live filtering:

**API Strategy:**
- Query `/markets/active?liveOnly=true` for in-play markets
- Hydrate odds via `/orders/odds/best` for each market
- Convert decimal odds to implied probabilities

**Live Detection Criteria:**
1. Market status is `ACTIVE` with `inPlay=true`
2. Has valid odds from best-odds endpoint
3. Game start time is in the past

**Odds Seeding:**
- SX.bet odds are immediately seeded to `LivePriceCache`
- Both outcome1 (YES) and outcome2 (NO) odds are cached

### 3.5 Unified Snapshot Policy

The worker applies a consistent policy for all platforms:

| Fetch Result | Action |
|--------------|--------|
| SUCCESS + NON-EMPTY | Update snapshot with new events |
| SUCCESS + EMPTY | Clear snapshot to 0 events (legitimate empty state) |
| FAILURE | Preserve previous snapshot, mark stale |

---

## 4. Cross-Platform Event Matching

### 4.1 Matchup Key System

The matcher uses a deterministic, fuzzy matchupKey-based approach:

**Key Format:** `sport|team1|team2` (teams sorted alphabetically)

Example: `NBA|boston celtics|new york knicks`

**Classification:**
- `classifyMarketKind()` categorizes titles into: `MATCHUP`, `TOTAL`, `SPREAD`, `TEAM_TOTAL`, `PROP`, `OTHER`
- Only `MATCHUP` items participate in cross-platform grouping
- Other types are excluded to prevent false matches

### 4.2 Matching Algorithm

```
1. Filter to MATCHUP-classified events
2. Extract/compute matchupKey for each event
3. Group by sport + time bucket (6-hour window)
4. For each pair across platforms:
   a. Time window check (events within 6 hours)
   b. Sport match check
   c. Sanity check (at least 2 shared tokens)
   d. Fuzzy match using fuzzball token_set_ratio (threshold: 90%)
5. Build connected components using Union-Find
6. Create MatchedEventGroup for each component with 2+ platforms
```

### 4.3 Team Name Normalization

The `title-matcher.ts` module provides:

- **Alias Map**: Common abbreviations → canonical names (e.g., "NYJ" → "new york jets")
- **Suffix Stripping**: Removes "Winner?", "O/U 40.5", spread lines, etc.
- **Team Separator Detection**: Handles "vs", "versus", "@", "at" patterns

### 4.4 Key Types

```typescript
interface VendorEvent {
  platform: 'SXBET' | 'POLYMARKET' | 'KALSHI';
  vendorMarketId: string;
  sport: Sport;
  homeTeam?: string;
  awayTeam?: string;
  startTime?: number;
  status: 'PRE' | 'LIVE' | 'ENDED';
  marketKind?: 'MATCHUP' | 'TOTAL' | 'SPREAD' | 'PROP' | 'OTHER';
  matchupKey?: string;  // Canonical key for cross-platform matching
  rawTitle: string;
  normalizedTitle?: string;
  normalizedTokens?: string[];
  outcomeTeam?: string;  // Which team YES represents (critical for arb)
}

interface MatchedEventGroup {
  eventKey: string;
  sport: Sport;
  homeTeam?: string;
  awayTeam?: string;
  startTime?: number;
  status: 'PRE' | 'LIVE' | 'ENDED';
  vendors: {
    SXBET?: VendorEvent[];
    POLYMARKET?: VendorEvent[];
    KALSHI?: VendorEvent[];
  };
  platformCount: number;
  matchQuality: number;
}
```

---

## 5. Arbitrage Detection

### 5.1 Mixed Market Arbitrage

The `arbitrage-sportsbook.ts` module handles arbitrage across different market types:

**Normalization:**
- All prices converted to implied probability [0,1]
- Prediction markets: `pYes = cents / 100`
- Sportsbooks: `pYes = 1 / decimalOdds`

**Arb Condition:**
```
pYes_platform1 + pNo_platform2 < 1
```

If total implied probability < 100%, arbitrage exists.

**Bet Sizing:**
- Target payout of $100 per contract
- Prediction markets: quantity = shares to buy
- Sportsbooks: stake = targetPayout / odds

### 5.2 Fee Calculations

The `fees.ts` module provides platform-specific fee calculations:

| Platform | Fee Structure |
|----------|---------------|
| **Kalshi** | `fee = 0.07 × C × P × (1-P)` (7% taker, 1.75% maker) |
| **Polymarket** | **No fees** - zero trading fees |
| **SX.bet** | **No fees** - zero trading fees |

**Fee-Aware Helpers:**
- `calculateMinimumGrossEdge()`: Minimum edge needed for profit
- `analyzeKalshiFeeZone()`: Identifies favorable price zones (near extremes)
- `calculateNetArbProfit()`: Full profit breakdown with fees

---

## 6. Safety Checks & Circuit Breaker

The `LiveArbSafetyChecker` provides layered protection:

| Check | Threshold | Severity |
|-------|-----------|----------|
| Price Age | `LIVE_ARB_MAX_PRICE_AGE_MS` (default 2000ms) | Critical |
| Slippage | `LIVE_ARB_MAX_SLIPPAGE_BPS` (default 100 bps) | Critical |
| Profit Margin | `LIVE_ARB_MIN_PROFIT_BPS` (default 50 bps) | Critical |
| Liquidity | `LIVE_ARB_MIN_LIQUIDITY_USD` (default $10) | Critical |
| Circuit Breaker | Open after 5 consecutive failures, 30s cooldown | Critical |

---

## 7. Dry-Fire (Paper Trading) Mode

### 7.1 Execution Mode

Stored in KV (`BotConfig.liveExecutionMode`):
- **DRY_FIRE** (default): Paper trading - detect opportunities but only log them
- **LIVE**: Execute real trades

### 7.2 Triple-Layer Protection

1. **Wrapper Layer** (`lib/execution-wrapper.ts`): Routes based on execution mode
2. **Guard Layer**: `assertNotDryFire()` throws if called in dry-fire mode
3. **Platform Layer**: Each `placeBet()` method has its own guard

### 7.3 Dry-Fire Logging

The `DryFireLogger` persists paper trades to Upstash KV:

```typescript
interface DryFireTradeLog {
  id: string;
  createdAt: string;
  mode: 'DRY_FIRE';
  opportunityId: string;
  legs: DryFireTradeLeg[];
  expectedProfitUsd: number;
  expectedProfitBps: number;
  status: 'SIMULATED' | 'REJECTED_BY_SAFETY' | 'REJECTED_BY_RISK' | 'REJECTED_BY_VALIDATION';
  rejectReasons?: string[];
  isLiveEvent: boolean;
  daysToExpiry: number;
  safetySnapshot?: SafetySnapshot;
}
```

---

## 8. Platform Integrations

### 8.1 Kalshi
- RSA-PSS signature authentication (`generateAuthHeaders`)
- Live sports discovery via series tickers and `expected_expiration_time`
- Order placement supports FOK limit orders
- WebSocket authentication with RSA-PSS signed messages

### 8.2 Polymarket
- Gamma API for event/market discovery with `event_date` filtering
- CLOB for order placement (EIP-712 signed)
- Live detection via `gameStartTime` and `sportsMarketType`
- Odds seeded from discovery results to price cache

### 8.3 SX.bet
- Ably-based WebSocket streaming (token auth via API key)
- Fetches `/markets/active?liveOnly=true` for live markets
- Hydrates odds via `/orders/odds/best`
- Full EIP-712 order signing for bet placement
- Best-odds channels for real-time price updates

All integrations return the shared `Market` interface for platform-agnostic arbitrage logic.

---

## 9. Storage & Configuration

| Store | Module | Usage |
|-------|--------|-------|
| **Upstash KV** | `lib/kv-storage.ts` | Balances, configuration, bets, dry-fire logs, worker heartbeat |
| **Local JSON** | `data/*.json` | Dev defaults |
| **Event Groups** | `lib/live-event-groups-store.ts` | Matched groups persisted to disk |

### 9.1 KV-Backed Runtime Configuration

**BotConfig** (`lib/kv-storage.ts`):
- `maxBetPercentage`, `maxDaysToExpiry`, `minProfitMargin`
- `liveExecutionMode` (DRY_FIRE | LIVE)
- `marketFilters` (sports-only, categories)

**LiveArbRuntimeConfig** (`/api/live-arb/config`):
- `liveArbEnabled`: Master switch for WebSocket ingestion + execution
- `ruleBasedMatcherEnabled`: Controls the rule-based matcher
- `sportsOnly`: Filters registry to sports markets only
- `liveEventsOnly`: **Critical** - triggers Live Sports Discovery for accurate live detection

### 9.2 Worker Heartbeat

The worker publishes heartbeat data to KV every 5 seconds:

```typescript
interface LiveArbWorkerHeartbeat {
  updatedAt: string;
  state: 'STARTING' | 'IDLE' | 'RUNNING' | 'STOPPING' | 'STOPPED';
  platforms: {
    sxbet: WorkerPlatformStatus;
    polymarket: WorkerPlatformStatus;
    kalshi: WorkerPlatformStatus;
  };
  priceCacheStats: WorkerPriceCacheStats;
  circuitBreaker: { isOpen: boolean; consecutiveFailures: number };
  liveEventsStats: { registry, matcher, watcher };
  pipelineDebug: RefreshPipelineDebug;
}
```

---

## 10. API Surface

### 10.1 Live Arb Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/live-arb/status` | Overall status, WS connections, cache stats |
| `GET/POST /api/live-arb/config` | Read/write runtime configuration |
| `GET/POST /api/live-arb/execution-mode` | Read/write execution mode |
| `GET /api/live-arb/live-events` | Registry snapshot, matched groups |
| `GET /api/live-arb/dry-fire-stats` | Aggregated dry-fire statistics |
| `GET /api/live-arb/dry-fire-export` | CSV export of dry-fire logs |
| `GET /api/live-arb/latency` | WebSocket latency statistics |
| `GET /api/live-arb/markets` | Current market data |
| `GET /api/live-arb/normalization-debug` | Debug normalization issues |

### 10.2 Dashboard Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/balances`, `/api/balances/refresh` | Cached balances + refresh |
| `/api/bets`, `/api/opportunity-logs` | Trade and opportunity reporting |
| `/api/config` | Bot configuration |
| `/api/health` | Health check |
| `/api/export`, `/api/export-opportunities` | Data export |

---

## 11. Live Arb Worker

The main entry point for live betting. Run via `npm run live-arb-worker`.

### 11.1 Boot Sequence

```
1. Write STARTING heartbeat to KV (immediate)
2. Start heartbeat loop (5s interval)
3. Load BotConfig from KV
4. Start main loop
```

### 11.2 Main Loop

```
1. Reload LiveArbRuntimeConfig
2. If liveArbEnabled toggled ON:
   a. Initialize LiveArbManager with WS clients
   b. Start LiveSportsOrchestrator
3. If liveArbEnabled toggled OFF:
   a. Stop orchestrator
   b. Shutdown LiveArbManager
4. If active: Run market refresh
5. Schedule next loop (15s active, 5s idle)
```

### 11.3 Market Refresh (Live Discovery Mode)

When `liveEventsOnly=true` and `sportsOnly=true`:

```
1. Fetch all platforms in parallel:
   - Polymarket: discoverPolymarketLiveSports()
   - Kalshi: discoverKalshiLiveSports()
   - SX.bet: discoverSXBetLiveSports()
2. Apply unified snapshot policy per platform
3. Seed odds to LivePriceCache
4. Convert to VendorEvents with enrichment
5. Update registry via markPlatformSnapshot()
6. Generate pipeline scoreboard
7. Write live events snapshot to KV
```

### 11.4 Pipeline Scoreboard

The worker generates a scoreboard each refresh cycle:

```typescript
interface PipelineScoreboard {
  byPlatform: {
    SXBET: { eventsDiscovered, pricesCached, eventsWithAnyOdds, matchedEventCount };
    POLYMARKET: { eventsDiscovered, pricesCached, matchedEventCount };
    KALSHI: { eventsDiscovered, pricesCached, matchedEventCount };
  };
  sxbetOdds: {
    watchedMarketHashesCount: number;
    bestOddsSubscribedCount: number;
    sampleWatchedMarkets: Array<{ marketHash, teams, oddsClassification }>;
  };
  summary: string;
}
```

---

## 12. Environment Variables

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
| `LIVE_ARB_IDLE_POLL_MS` | `5000` | Idle polling interval |
| `WORKER_HEARTBEAT_INTERVAL_MS` | `5000` | Heartbeat interval |
| `WORKER_SHUTDOWN_GRACE_MS` | `25000` | Shutdown grace period |
| `KALSHI_WS_URL` | `wss://api.elections.kalshi.com/trade-api/ws/v2` | Kalshi WebSocket |
| `POLYMARKET_WS_URL` | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | Polymarket WS |

---

## 13. Testing

| Script | Purpose |
|--------|---------|
| `npm run test-live-arb` | Test LivePriceCache, safety checks |
| `npm run test-live-events` | Test token normalization, matching, registry |
| `npm run test-live-ws` | Test WebSocket connections |
| `npm run test:kalshi-live` | Test Kalshi live sports discovery |
| `npm run test:poly-live` | Test Polymarket live sports discovery |
| `npm run test:sxbet-discovery` | Test SX.bet live sports discovery |
| `npm run test:live-sports` | Test all platform discoveries |
| `npm run test:arb-math` | Test arbitrage math calculations |
| `npm run test:outcome-alignment` | Test outcome team alignment |
| `npm run test-fees` | Test fee calculations |
| `npm run dump-arb-logs` | Dump arbitrage logs |

---

## 14. Deployment & Operations

### Running the Live Arb Worker

```bash
# Development
npm run live-arb-worker

# Production (PM2)
pm2 start npm --name "live-arb-worker" -- run live-arb-worker
```

### Enabling Live Arbitrage

1. Configure platform API credentials in environment
2. Navigate to `/live-arb` dashboard
3. Enable "Live Arb Enabled" and "Rule-Based Matcher"
4. Enable "Live Events Only" for pure live-betting mode
5. Start the live-arb-worker process

### Going from Paper Trading to Live

1. Monitor dry-fire logs to validate opportunity detection
2. Review rejection reasons and tune thresholds
3. Change Execution Mode to "LIVE" via dashboard
4. Monitor `/api/live-arb/status` for results

### Monitoring Checklist

- **Worker Health**: Check heartbeat state in KV
- **WebSocket Status**: Verify all 3 platforms connected
- **Price Cache**: Monitor cache size and staleness
- **Pipeline Scoreboard**: Review events discovered vs matched
- **Circuit Breaker**: Ensure not open

---

## 15. Key Files Reference

### Core Logic
- `lib/live-arb-manager.ts` - Main orchestration
- `lib/live-price-cache.ts` - Price caching
- `lib/live-event-registry.ts` - Event storage
- `lib/live-event-matcher.ts` - Cross-platform matching
- `lib/arbitrage-sportsbook.ts` - Arb calculations
- `lib/execution-wrapper.ts` - Trade execution routing

### Discovery
- `lib/live-sports-discovery.ts` - Central coordinator
- `lib/live-sports-discovery-polymarket.ts` - Polymarket discovery
- `lib/live-sports-discovery-kalshi.ts` - Kalshi discovery
- `lib/live-sports-discovery-sxbet.ts` - SX.bet discovery

### Matching
- `lib/title-matcher.ts` - Market classification & matchup keys
- `lib/text-normalizer.ts` - Token normalization
- `lib/matchup-key.ts` - Matchup key utilities

### Platform Clients
- `services/kalshi-ws.ts` - Kalshi WebSocket
- `services/polymarket-ws.ts` - Polymarket WebSocket
- `services/sxbet-ws.ts` - SX.bet Ably WebSocket
- `lib/markets/kalshi.ts` - Kalshi REST API
- `lib/markets/polymarket.ts` - Polymarket REST API
- `lib/markets/sxbet.ts` - SX.bet REST API

### Worker
- `workers/live-arb-worker.ts` - Main worker process

---

## 16. Future Work

- **Distributed price cache**: Redis pub/sub for multi-container deployments
- **Additional WS platforms**: Extensible WS client pattern
- **Dry-fire analytics**: Time-series analysis of paper trades
- **Sport-specific matching**: Customize matching logic per sport
- **Enhanced latency tracking**: Per-platform latency histograms
- **Auto-scaling**: Dynamic subscription limits based on load
