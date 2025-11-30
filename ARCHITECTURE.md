# AlgoBet Architecture

This document describes the live betting arbitrage system. AlgoBet is a **pure live-betting application** that detects and executes arbitrage opportunities across Kalshi, Polymarket, and SX.bet in real-time using WebSocket feeds and rule-based event matching.

---

## 1. System Overview

| Layer | Location | Responsibilities |
|-------|----------|------------------|
| **Dashboard** | `pages/`, `components/` | Next.js 14 + React UI for balances, configuration, exports, and live-arb controls. |
| **Live Arb API** | `pages/api/live-arb/**/*` | Control plane for live-arb configuration, execution mode, dry-fire stats, and status. |
| **Live Arb Worker** | `workers/live-arb-worker.ts` | Long-running process that orchestrates WebSocket connections, event registry, and arb detection. |
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
| **LiveArbSafetyChecker** | `lib/live-arb-safety.ts` | Circuit breakers and safety checks for live execution |
| **ExecutionWrapper** | `lib/execution-wrapper.ts` | Routes between real execution and dry-fire mode |
| **DryFireLogger** | `lib/dry-fire-logger.ts` | Persistence layer for paper trade logs |

### 2.2 WebSocket Clients

Each platform has a dedicated WebSocket client following the same pattern:

**Common features:**
- Connection state machine: `disconnected` → `connecting` → `connected` → `reconnecting` → `error`
- Exponential backoff reconnection
- Heartbeat/ping to detect stale connections
- Subscription management with pending queue for pre-connection subscriptions
- State change handlers for monitoring

| Platform | Location | Features |
|----------|----------|----------|
| **SX.bet** | `services/sxbet-ws.ts` | Best-odds, live-scores, line-changes feeds; configurable WS endpoint via `SXBET_WS_URL` (empty = REST-only fallback) |
| **Polymarket** | `services/polymarket-ws.ts` | Orderbook updates and last trade prices per market |
| **Kalshi** | `services/kalshi-ws.ts` | Orderbook deltas and ticker updates (WS handshake reuses RSA-PSS headers via `buildKalshiAuthHeaders`; defaults to `wss://api.elections.kalshi.com/trade-api/ws/v2` unless `KALSHI_WS_URL` is set) |

### 2.3 Market Fetching

The `LiveMarketFetcher` (`lib/live-market-fetcher.ts`) provides a simple interface to fetch markets from all platforms:

```typescript
const fetcher = new LiveMarketFetcher();
const filters = fetcher.buildFiltersFromConfig(botConfig, runtimeConfig);
const results = await fetcher.fetchAllPlatforms(filters);
```

**Filter Parameters** (from `MarketFilterInput`):
- `liveOnly`: When true, only fetch markets expiring within 3 hours (derived from `LiveArbRuntimeConfig.liveEventsOnly`)
- `sportsOnly`: When true, only fetch sports-related markets
- `windowStart` / `windowEnd`: Time window for market expiry

**Live-Only Filtering Logic**:
When `liveEventsOnly` is enabled in runtime config:
1. Markets are filtered to those expiring within 3 hours (likely in-play)
2. Sports markets use the `sportsbook` market type or title pattern matching
3. Each platform's response is filtered before populating the registry

This calls the platform-specific APIs:
- **Kalshi**: `KalshiAPI.getOpenMarkets(maxDays)`
- **Polymarket**: `PolymarketAPI.getOpenMarkets(maxDays)`
- **SX.bet**: `SXBetAPI.getOpenMarkets(maxDays)`

---

## 3. Rule-Based Live Sports Matcher

The rule-based matcher provides deterministic cross-platform event matching for live sporting events using simple, reliable heuristics.

### 3.1 Token-Based Matching Algorithm

**No AI/ML, No Large Alias Maps** - Pure deterministic token overlap:

1. **Token Normalization**: Titles are normalized to token arrays (stopwords/sport keywords removed)
2. **Sport + Time Bucketing**: Events are grouped by sport and time bucket (default 15 min tolerance)
3. **Token Overlap Scoring**: Score `overlap`, `coverage`, and `jaccard` between token sets
4. **Connected Components**: Events with sufficient overlap form graph edges; matched groups are connected components

**Key Functions (`lib/text-normalizer.ts`):**
- `normalizeEventTitle(rawTitle, opts)`: Returns `{ normalizedTitle, tokens }`
- `scoreTokenOverlap(tokensA, tokensB)`: Returns `{ overlap, coverage, jaccard }`
- `tokensMatch(tokensA, tokensB, minOverlap, minCoverage)`: Boolean match check

### 3.2 Key Types

```typescript
interface VendorEvent {
  platform: 'SXBET' | 'POLYMARKET' | 'KALSHI';
  vendorMarketId: string;
  sport: Sport;
  homeTeam?: string;
  awayTeam?: string;
  teams: string[];
  normalizedTitle?: string;
  normalizedTokens?: string[];
  startTime?: number;
  status: 'PRE' | 'LIVE' | 'ENDED';
  rawTitle: string;
}

interface MatchedEventGroup {
  eventKey: string;
  sport: Sport;
  homeTeam?: string;
  awayTeam?: string;
  vendors: {
    SXBET?: VendorEvent[];
    POLYMARKET?: VendorEvent[];
    KALSHI?: VendorEvent[];
  };
  platformCount: number;
  matchQuality: number;
}
```

### 3.3 Event Watchers

Watchers are event-driven and scoped:
- **Event-driven**: Triggered by `LivePriceCache` price update callbacks, not blind polling
- **Scoped scans**: Each watcher ONLY evaluates markets in its `MatchedEventGroup`
- **Debounced**: Rapid price updates are debounced (50ms) to prevent check storms
- **Fallback polling**: 5-second safety net if WS is spotty

### 3.4 File Persistence

Matched event groups are automatically persisted for debugging:
- **Production/Vercel**: `/tmp/live-event-groups.json`
- **Local development**: `data/live-event-groups.json`

---

## 4. Safety Checks & Circuit Breaker

The `LiveArbSafetyChecker` provides layered protection:

| Check | Threshold | Severity |
|-------|-----------|----------|
| Price Age | `LIVE_ARB_MAX_PRICE_AGE_MS` (default 2000ms) | Critical |
| Slippage | `LIVE_ARB_MAX_SLIPPAGE_BPS` (default 100 bps) | Critical |
| Profit Margin | `LIVE_ARB_MIN_PROFIT_BPS` (default 25 bps) | Critical |
| Liquidity | `LIVE_ARB_MIN_LIQUIDITY_USD` (default $10) | Critical |
| Platform Skew | `LIVE_ARB_MAX_SKEW_PCT` (default 20%) | Critical |
| Circuit Breaker | Open after N consecutive failures | Critical |

**Circuit breaker behavior:**
- Opens after `maxConsecutiveFailures` (default 5)
- Stays open for `cooldownMs` (default 30s)
- Automatically resets after cooldown
- Can be manually tripped via `tripCircuit(reason)`

---

## 5. Dry-Fire (Paper Trading) Mode

The dry-fire mode allows the system to run all arbitrage detection, pricing, and risk checks without placing real orders.

### 5.1 Execution Mode

Execution mode is stored in KV (`BotConfig.liveExecutionMode`) and managed via `/api/live-arb/execution-mode`:

- **DRY_FIRE** (default): Paper trading - detect opportunities but only log them
- **LIVE**: Execute real trades

### 5.2 Triple-Layer Protection

1. **Wrapper Layer** (`lib/execution-wrapper.ts`):
   - `executeOpportunityWithMode()` reads `BotConfig.liveExecutionMode` before routing
   - Routes to `executeOpportunityDryFire()` which never calls platform APIs

2. **Guard Layer**:
   - `assertNotDryFire()` throws if called in dry-fire mode
   - Used as additional check in real execution path

3. **Platform Layer** (`lib/markets/*.ts`):
   - Each `placeBet()` method has its own guard
   - Returns error if `isDryFireMode()` is true

### 5.3 DryFireTradeLog Schema

```typescript
interface DryFireTradeLog {
  id: string;
  createdAt: string;
  mode: 'DRY_FIRE';
  opportunityId: string;
  opportunityHash: string;
  legs: DryFireTradeLeg[];
  expectedProfitUsd: number;
  expectedProfitBps: number;
  expectedProfitPct: number;
  totalInvestment: number;
  status: 'SIMULATED' | 'REJECTED_BY_SAFETY' | 'REJECTED_BY_RISK' | 'REJECTED_BY_VALIDATION';
  rejectReasons?: string[];
  isLiveEvent: boolean;
  daysToExpiry: number;
  safetySnapshot?: SafetySnapshot;
}
```

---

## 6. Platform Integrations

### 6.1 Kalshi (`lib/markets/kalshi.ts`, `services/kalshi.ts`)
- Authenticated requests use RSA-PSS signatures (`generateAuthHeaders`)
- `getOpenMarkets(maxDays)` fetches tradable markets within window
- Balance helper consolidates cash + portfolio value
- Order placement supports FOK limit orders

### 6.2 Polymarket (`lib/markets/polymarket.ts`, `services/polymarket.ts`)
- Hybrid Gamma/CLOB client for market ingestion
- Normalizes outcomes, token IDs, and prices into `Market` objects
- Order placement signs EIP-712 payloads and posts to CLOB

### 6.3 SX.bet (`lib/markets/sxbet.ts`, `services/sxbet.ts`)
- Fetches `/markets/active` with pagination
- Hydrates odds via `/orders/odds/best` with USDC base token filter
- Full EIP-712 order signing for order placement

All integrations return the shared `Market` interface so arbitrage logic remains platform-agnostic.

---

## 7. Storage & Configuration

| Store | Module | Usage |
|-------|--------|-------|
| **Upstash KV** | `lib/kv-storage.ts` | Balances, configuration, bets, arbitrage groups, opportunity logs, daily stats, dry-fire logs |
| **Local JSON** | `data/storage.json`, `data/bot-status.json` | Dev defaults |
| **Event Groups** | `lib/live-event-groups-store.ts` | Matched event groups persisted to disk for debugging |

### 7.1 KV-Backed Runtime Configuration

All runtime configuration is managed via KV storage (no boolean env flags):

**BotConfig** (`lib/kv-storage.ts`):
- `maxBetPercentage`, `maxDaysToExpiry`, `minProfitMargin`
- `balanceThresholds` (per-platform)
- `emailAlerts` settings
- `simulationMode`
- `liveExecutionMode` (DRY_FIRE | LIVE)
- `marketFilters` (sports-only, categories, etc.)
- Auto-seeded via `getOrSeedBotConfig()` when missing, which writes a conservative DRY_FIRE configuration (simulation mode on, small bet sizing) into KV so every process has safe defaults without noisy warnings.

**LiveArbRuntimeConfig** (`/api/live-arb/config`):
- `liveArbEnabled`: Master switch for WebSocket ingestion + execution
- `ruleBasedMatcherEnabled`: Controls the rule-based matcher
- `sportsOnly`: Filters registry inputs to sports markets only
- `liveEventsOnly`: **Critical for live-only mode**:
  - When `true`: Only fetches markets expiring within 3 hours
  - Filters VendorEvents to `status === 'LIVE'` in matcher
  - Excludes PRE (pre-game) events from matched groups
  - This is the primary control for running as a pure live-betting engine

🚨 **Operational Lock**: All of the above runtime toggles are now hard-wired to `true` inside KV storage. The dashboard no longer exposes buttons to flip them, ensuring the live arb worker always runs with streaming enabled, the matcher active, and sports/live filters enforced.

---

## 8. API Surface (`pages/api`)

### 8.1 Live Arb Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/live-arb/status` | Overall status, WS connections, cache stats, circuit breaker |
| `GET/POST /api/live-arb/config` | Read/write live-arb runtime configuration |
| `GET/POST /api/live-arb/execution-mode` | Read/write execution mode (DRY_FIRE/LIVE) |
| `GET /api/live-arb/live-events` | Registry snapshot, matched groups, watcher stats |
| `GET /api/live-arb/markets` | Markets with live prices |
| `GET /api/live-arb/dry-fire-stats` | Aggregated dry-fire statistics |
| `GET /api/live-arb/dry-fire-export` | CSV export of dry-fire logs |

`/live-arb` UI actions only call these endpoints. The Start/Stop buttons POST to `/api/live-arb/config` to flip `liveArbEnabled`/`ruleBasedMatcherEnabled`, and the dashboard polls `/api/live-arb/status`, which now includes the KV-backed worker heartbeat (`workerPresent`, `workerState`, `runtimeConfig`) so the UI never shells out to legacy `/api/bot/*` routes.

### 8.2 Dashboard Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/balances`, `/api/balances/refresh` | Serve cached balances + trigger on-demand refresh |
| `/api/bets`, `/api/opportunity-logs` | Trade and opportunity reporting |
| `/api/config`, `/api/data` | Read/write bot configuration |
| `/api/export`, `/api/export-opportunities` | Data exports for dashboard |
| `/api/health` | Health check endpoint |

---

## 9. Dashboard & UI

### 9.1 Main Dashboard (`/dashboard`)
- Balance overview (total, per-platform)
- Profit charts and stats
- Configuration panel
- Link to Live Betting Control

### 9.2 Live Arb Dashboard (`/live-arb`)
- **Runtime Config Summary**: Status text only (toggles removed; config is always-on)
- **Execution Mode Toggle**: DRY_FIRE / LIVE
- **Start/Stop Controls**: POST to `/api/live-arb/config` to reassert the always-on KV flags; worker presence is derived from `/api/live-arb/status`.
- **System Status**: WS connections, price cache stats, circuit breaker state
- **Matched Events Table**: Cross-platform matches with sport, teams, platforms, quality
- **Dry-Fire Statistics**: Simulated vs rejected trades, potential profit
- **Watcher Performance**: avg/max check time, checks/sec

---

## 10. Live Arb Worker (`workers/live-arb-worker.ts`)

The main entry point for live betting. Run via `npm run live-arb-worker`.

**Boot sequence:**
1. Load `BotConfig` + live-arb runtime config from KV
2. Exit quickly if `liveArbEnabled=false`
3. Log execution mode (`BotConfig.liveExecutionMode`, profit thresholds)
4. Initialize `LiveArbManager` with WS clients
5. Start `LiveSportsOrchestrator` with platform adapters
6. Continuously refresh registry by fetching live markets via `LiveMarketFetcher`

**Market Refresh Loop:**
Each refresh cycle (default every 15s):
1. Reload `LiveArbRuntimeConfig` to pick up config changes
2. Build filters from `BotConfig` + `runtimeConfig` (includes `liveOnly`, `sportsOnly`)
3. Fetch from all platforms with filtering applied
4. Update registry via `refreshRegistry()`
5. If `liveEventsOnly=true`, matcher only considers `LIVE` status events

**Heartbeat Reporting:**
- After startup, each refresh, and shutdown the worker calls `updateWorkerHeartbeat()` (KV), recording `state`, `updatedAt`, and summary metadata so `/api/live-arb/status` can expose `workerPresent`/`workerState` to the dashboard.

**Logging tags:**
- `[LiveArbWorker]`: Startup, refresh summaries, shutdown
- `[LiveArbManager]`: Initialization, subscription diffs, circuit-breaker activity
- `[SXBET-WS]`, `[POLYMARKET-WS]`, `[KALSHI-WS]`: Connection lifecycle
- `[LivePriceCache]`: Debug stats, fallback notifications
- `[LiveWatcher]`: Creation/teardown, arb-check triggers, opportunities
- `[LiveArb]`: Execution-wrapper decisions

---

## 11. Environment Variables

**Important**: This system uses **NO boolean environment variables** for feature flags. All runtime toggles are controlled via KV-backed configuration (`BotConfig`, `LiveArbRuntimeConfig`). Environment variables are used **only** for:
- API credentials (keys, secrets)
- URLs and endpoints
- Numeric tuning parameters

This ensures all feature flags can be changed via the UI without redeployment.

### Required Credentials

| Variable | Description |
|----------|-------------|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis credentials |
| `KALSHI_API_KEY`, `KALSHI_PRIVATE_KEY` | Kalshi API authentication |
| `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_PRIVATE_KEY` | Polymarket CLOB |
| `SXBET_API_KEY`, `SXBET_PRIVATE_KEY`, `SXBET_WALLET_ADDRESS` | SX.bet API + wallet |

### Optional Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVE_ARB_MIN_PROFIT_BPS` | `50` | Minimum profit (basis points) |
| `LIVE_ARB_MAX_PRICE_AGE_MS` | `2000` | Max acceptable price age |
| `LIVE_ARB_MAX_LATENCY_MS` | `2000` | Max execution latency |
| `LIVE_ARB_MAX_SLIPPAGE_BPS` | `100` | Max slippage (basis points) |
| `LIVE_ARB_LOG_LEVEL` | `info` | Log level (`info` or `debug`) |
| `LIVE_ARB_WORKER_REFRESH_MS` | `15000` | Market refresh interval |
| `SXBET_WS_URL` | _(none — configure vendor URL)_ | SX.bet WebSocket URL (set to Ably endpoint; leave blank to disable WS client) |
| `KALSHI_WS_URL` | `wss://api.elections.kalshi.com/trade-api/ws/v2` | Kalshi WebSocket endpoint override (must match the signed `/trade-api/ws/v2` path) |
| `POLYMARKET_WS_URL` | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | Polymarket WS |

---

## 12. Testing

| Script | Purpose |
|--------|---------|
| `npm run test-live-arb` | Test LivePriceCache, safety checks, configuration |
| `npm run test-live-events` | Test token normalization, matching, registry |
| `npm run test-live-ws-connections` | Test WebSocket connections to all platforms |
| `npm run test-execution-mode` | Test KV-backed execution mode |
| `npm run test-live-arb-runtime-config` | Test runtime config loading |

---

## 13. Deployment & Operations

### Running the Live Arb Worker

```bash
# Development
npm run live-arb-worker

# Production (PM2 or similar)
pm2 start npm --name "live-arb-worker" -- run live-arb-worker
```

### Enabling Live Arbitrage

1. Ensure all platform API credentials are configured
2. Navigate to `/live-arb` dashboard
3. Enable "Live Arb Enabled" toggle
4. Enable "Rule-Based Matcher" toggle
5. Optionally enable "Sports Only" and/or "Live Events Only"
6. Start the live-arb-worker process

### Going from Paper Trading to Live

1. Monitor dry-fire logs to validate opportunity detection
2. Review rejection reasons and tune thresholds if needed
3. When confident, change Execution Mode to "LIVE" via dashboard
4. Monitor `/api/live-arb/status` for execution results

---

## 14. Future Work Hooks

- **Distributed price cache**: For multi-container deployments, the in-memory `LivePriceCache` could be backed by Redis pub/sub
- **Additional WS platforms**: The WS client pattern is designed to be extensible
- **Dry-fire analytics**: Add time-series analysis of paper trades
- **A/B threshold testing**: Run multiple parameter sets in parallel dry-fire mode
- **Sport-specific matching rules**: Customize matching logic per sport

This architecture keeps trading logic centralized, provides real-time price streaming, and enables safe paper trading before going live.
