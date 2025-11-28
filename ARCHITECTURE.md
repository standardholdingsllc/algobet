# AlgoBet Architecture

This document describes the current source code under `lib/`, `pages/`, `workers/`, and `services/`. It supersedes all earlier write-ups and focuses on the concrete engineering decisions now in the repository.

---

## 1. System Overview

| Layer | Location | Responsibilities |
|-------|----------|------------------|
| **Dashboard** | `pages/`, `components/` | Next.js 14 + React UI for balances, opportunity logs, exports, and bot controls. |
| **Serverless API** | `pages/api/**/*` | Control plane for configuration, balance refresh, exports, watchdog/health endpoints, and the `/api/bot/cron` trigger. |
| **Cron Bot** | `lib/bot.ts` (invoked via API routes) | Sequential arbitrage scanner that consumes cached market snapshots, runs risk checks, sizes orders, and executes trades. |
| **Snapshot Worker** | `workers/snapshot-worker.ts` | Continuously fetches/normalizes markets via adapter registry, validates snapshots, and pushes them into Upstash + disk mirrors. |
| **Legacy Scanner** | `workers/scanner.ts` | Historical long-running worker that still mirrors the bot loop for backfilling GitHub storage. |
| **Storage** | `lib/kv-storage.ts`, `lib/market-snapshots.ts`, `lib/market-source-config.ts` | KV for runtime state + config, Upstash/disk for validated market snapshots, Upstash config documents for platform filter schemas. |

The cron bot, snapshot worker, and dashboard all share the same market clients, arbitrage engine, fee calculator, storage helpers, and email alerts to avoid drift.

---

## 2. Market Feed Architecture

### 2.1 MarketSourceConfig (Upstash-backed schema)
- File: `lib/market-source-config.ts`
- Key: `algobet:market-source-config`
- Shape: `MarketSourceConfig` (see `types/index.ts`) with one entry per platform:
  - `defaultAdapter`: canonical adapter ID.
  - `adapters`: `Record<string, MarketAdapterConfig>` describing endpoint, method, pagination, and filter bindings.
  - `supportedFilters`: whitelist of normalized filter tokens (`windowStart`, `windowEnd`, `sportsOnly`, `leagueTickers`, etc.).
- Defaults live in code and are merged with any remote overrides so we never regress if the Upstash entry is partial.
- Primary goal: filters (e.g., Kalshi `min_close_ts` / `max_close_ts`) are defined once, referenced by docs URL, and cannot silently drift—misnamed params become impossible without updating the shared schema.

### 2.2 MarketFeedService (`lib/market-feed-service.ts`)
- Builds normalized filters from `BotConfig` (including the new `marketFilters` preferences).
- Resolves the correct adapter for each platform via `MarketSourceConfig`.
- Adapter handler registry:
  - `kalshi:markets` and `kalshi:events` (direct HTTP with documented filters).
  - `polymarket:hybrid` (reuses the existing hybrid Gamma/CLOB client).
  - `sxbet:rest` (wraps the SX.bet REST integration).
- Provides three key methods:
  1. `fetchLiveMarketsForPlatform/Platforms` – hits upstream APIs through adapters (used by the snapshot worker and as a bot fallback).
  2. `loadCachedMarkets` – reads validated snapshots from Redis/disk and, if configured, falls back to live fetches when cache is stale/missing. When the bot opts into `persistOnFallback`, any live payload collected during that fallback is written back to Redis + disk immediately so the next run can reuse it even if the worker is offline.
  3. `persistSnapshots` – writes adapter metadata + filters back to the snapshot layer with schema versioning.
- Shared helpers convert normalized filters into query params based on adapter `filterBindings`. Dates are coerced to ISO, CSV lists respect `joinWith`, and boolean bindings obey `trueValue/falseValue/omitIfFalse`.
- Adapter configs can advertise a `minMarkets` expectation (e.g., SX.bet requires ≥100). If a cached snapshot falls below that threshold (based on `totalMarkets` or the `rawMarkets` metadata), the service logs `[MarketFeed] Snapshot for <platform> flagged as suspect`, forces a live refetch, and—when canonical filters are in play—self-heals the Redis/disk entry so the next cron invocation sees the fuller universe instead of continuing with a tiny snapshot.

### 2.3 Platform-specific behavior
- **Kalshi**
  - Requests now use the documented `min_close_ts` / `max_close_ts` query parameters (Unix timestamps in seconds) and drop undocumented sorting flags. The adapter enforces Kalshi’s timestamp-family compatibility matrix (e.g., close-time filters never send `status=open`) so every query stays inside the published contract.
  - Pagination obeys adapter config (`limit=200`, optional `maxPages=8`) and now follows Kalshi’s top-level `cursor` field until it becomes empty. Each page log includes request params, raw counts, tradable counts, and the returned cursor so missing pages are obvious.
  - A secondary `kalshi:events` adapter targets `/events/{ticker}/markets` for league-specific feeds (driven by `leagueTickers` filter tokens).
- **Polymarket**
  - Default adapter remains `polymarket:hybrid`, which leans on the battle-tested hybrid Gamma/CLOB client (`lib/markets/polymarket.ts`) so we retain per-page caching, fallbacks, and pricing normalization. Future overrides can switch to a pure Gamma adapter without touching the bot.
  - Expiry derivation now classifies markets as “sports” when the upstream metadata advertises a sports type/`gameId`, when `gameStartTime` and the closing window are within 48 hours, or when the question title clearly matches `vs.`/“win on” patterns. Only those sports-like markets prefer `gameStartTime`; all others fall back to `eventStartTime`/UMA/end dates so “by November 30” style markets remain inside the execution window. Logging records how many snapshots used `gameStartTime` vs. how many ignored it as non-sports, along with samples of each.
- **SX.bet**
  - Adapter metadata now documents `/markets/active` pagination knobs (pageSize=50, paginationKey/nextKey) so the handler can walk every page before hydrating odds. Typical runs ingest several hundred active markets unless a `maxPages` cap is configured for safety.
  - `/orders/odds/best` remains the only place we apply the USDC base token filter; `/markets/active` is kept wide open per the docs. The handler wraps `SXBetAPI.getOpenMarkets`, so fee/odds logic stays centralized and logs summarize page-by-page counts.
  - Odds hydration is rate-limit aware: markets are sorted by earliest expiry, odds are reused from the previous snapshot when they’re ≤5 minutes old (`oddsAsOf` on each market), and `/orders/odds/best` chunks run sequentially with small delays/exponential backoff. If SX.bet returns 429 after the configured retries, the adapter logs the remaining market count, stops requesting, and still returns the odds it already collected so we never lose the whole run.
  - Snapshot metadata records `rawMarkets`, `withinWindow`, `hydratedWithOdds`, `reusedOdds`, `pagesFetched`, and `stopReason`. The suspicious-snapshot guard treats SX.bet snapshots with <100 `rawMarkets`/`withinWindow`/`hydratedWithOdds` as suspect and automatically refetches + self-heals Redis/disk on the next cron invocation.
  - The platform’s `rest-active` adapter declares `minMarkets=100`. If cached snapshots report fewer than that (or the `rawMarkets` metadata drops below the threshold), MarketFeedService forces a live refetch and self-heals Redis/disk, preventing the bot from silently trading on a 25-market slice when the upstream exchange actually has ~2k active contracts.

---

## 3. Market Snapshot Pipeline (`lib/market-snapshots.ts`)

- Snapshots are persisted both to disk (`data/market-snapshots/*.json` locally or `/tmp/market-snapshots` on Vercel) and to Upstash keys `market-snapshots:<platform>`.
- New schema (v2) is defined in `types/index.ts`:
  ```ts
  interface MarketSnapshot {
    schemaVersion: number;
    platform: 'kalshi' | 'polymarket' | 'sxbet';
    fetchedAt: string;
    maxDaysToExpiry?: number;
    adapterId?: string;
    filters?: MarketFilterInput;
    totalMarkets: number;
    markets: Market[];
  meta?: {
    rawMarkets?: number;
    withinWindow?: number;
    hydratedWithOdds?: number;
    stopReason?: string;
    pagesFetched?: number;
    writer?: string;
  };
  }
  ```
- Validation (`validateMarketSnapshot`) runs before every write and after every read:
  - Ensures schema version is numeric, timestamps are parseable, each market carries IDs/prices/expiry, and per-market platform tags match the snapshot envelope.
  - Invalid payloads never touch disk or Redis; stale/invalid cached entries raise warnings so the worker can self-heal.
- Snapshot loads now log the Redis/disk source, age vs TTL, schema version, adapter ID, and filter metadata. The bot only emits “missing or stale” warnings when freshness/schema checks actually fail, and it includes the precise reason when it falls back to live fetches.
- `loadMarketSnapshot` prefers Upstash but automatically falls back to disk. `isSnapshotFresh` ensures trading code can enforce TTLs (default ≤ `MARKET_SNAPSHOT_TTL_SECONDS`).
- `saveMarketSnapshots` now accepts per-platform metadata (adapter ID, filters, schema version) so downstream consumers know exactly which adapter produced a given snapshot.
- The snapshot worker logs each successful write via `[SnapshotWorker] Saved snapshot ...` including adapter ID, schema version, Redis key, and disk path so it is obvious where the payload landed.
- Ops can hit `/api/snapshots/debug` to inspect freshness, schema version, adapter metadata, and diagnostics (e.g., “missing in redis”) for each platform without triggering a bot scan.
- Snapshot metadata (`meta`) captures adapter stats so debugging SX.bet is trivial: `rawMarkets` counts the direct `/markets/active` rows, `withinWindow` counts markets that survived the execution window, `hydratedWithOdds` reports how many markets actually have USDC odds, `reusedOdds` shows how many of those odds were carried forward from the previous snapshot, and `stopReason`/`pagesFetched` document the pagination status. Each `Market` now carries an `oddsAsOf` timestamp so odds reuse is bounded (currently 5 minutes).
- Snapshot metadata (`meta`) captures adapter stats so debugging SX.bet is trivial: `rawMarkets` counts the direct `/markets/active` rows, `withinWindow` counts markets that survived the execution window, `hydratedWithOdds` reflects odds coverage, `stopReason` records why pagination ended (e.g., `maxPages cap (40)`), `pagesFetched` mirrors the adapter log, and `writer` indicates whether the snapshot came from the always-on worker or the bot’s self-healing fallback.

### 3.4 Self-healing snapshot seeding

- `MarketFeedService.loadCachedMarkets` can optionally persist live fallback payloads back to the snapshot store. This self-healing mode is gated behind an internal token that is only attached when `buildFiltersFromConfig` is used, preventing debug scripts from overwriting canonical snapshots with ad-hoc filters.
- The cron bot enables `persistOnFallback` with the same filters the snapshot worker would use. The very first cron run in a brand-new environment therefore seeds `market-snapshots:*` in Upstash (and `/tmp/market-snapshots/*.json` on disk) even if `npm run snapshot-worker` isn’t running yet. Subsequent runs immediately benefit from cached payloads.
- The snapshot worker remains the primary, always-on refresher. The bot’s persistence is intentionally opportunistic—it keeps trading when caches are cold and gives operators breathing room to restart the worker.

### 3.5 LLM-ready snapshot derivations

- `/api/snapshots/llm` streams a stripped, download-only JSON payload that is derived from cached snapshots via `loadMarketSnapshotWithSource` (never by hitting upstream vendors).
- `lib/llm-snapshots.ts` converts a `MarketSnapshot` into the slimmer `LlmReadySnapshot`, keeping only the semantic fields DeepSeek needs (`id`, `platform`, market type, title, expiry ± optional taxonomy) and recording a fresh `generatedAt` timestamp for each download.
- The dashboard exposes a “Download LLM-ready snapshots” card with the same styling as the raw snapshot card so operators can grab either the full JSON or the token-efficient version without leaving the UI.
- LLM-ready Kalshi payloads automatically drop the noisy `KXMVESPORTSMULTIGAMEEXTENDED-*` multi-leg markets so the matcher doesn’t waste tokens on combinatorial tickets. Canonical snapshots still retain them for other tooling.

**Verification flow**
1. Trigger one bot invocation (e.g., hit `/api/bot/cron` via Vercel Scheduler or run `curl -X POST https://<deployment>/api/bot/cron` locally with the right auth headers).
2. Call `/api/snapshots/debug` in the same environment (dashboard button or `curl https://<deployment>/api/snapshots/debug`).
3. Confirm each platform shows a Redis or disk snapshot with:
   - `schemaVersion=2`
   - `filters.windowStart/windowEnd` that match the active `BotConfig` window (≈ `maxDaysToExpiry`)
   - Adapter IDs that reflect the active registry (`kalshi:markets`, `polymarket:hybrid`, etc.)
4. Start (or keep running) `npm run snapshot-worker` on your long-lived Node host. Watch its `[SnapshotWorker] Saved snapshot ...` logs to verify it keeps refreshing the same keys and directories; the bot will automatically fall back to the worker-provided snapshots on subsequent scans.

### 3.6 Gemini-powered match graph (daily)

- `pages/api/match-graph/run.ts` is a dedicated Vercel cron endpoint (schedule it once per day, e.g., noon UTC) that orchestrates an LLM-only job. It requires `MATCH_GRAPH_CRON_SECRET` (falls back to `CRON_SECRET`) and can be dry-run with `?persist=false`.
- `lib/gemini-match-graph.ts` drives the workflow:
  1. Loads the latest cached snapshots for `kalshi`, `polymarket`, and `sxbet`, converts them to their `LlmReadySnapshot` form (id, title, type, expiry only), and optionally trims the set with `maxMarketsPerPlatform`.
  2. Builds a single JSON payload `{ "kalshi":[{key,title,type,expiry}], ... }` plus a natural-language instruction block that defines the allowed edge types (`same_event`, `same_outcome`, `opposite_outcome`, `subset`), explains the market key convention (`<platform>:<id>`), and embeds the response schema.
  3. Calls **Gemini 2.0 Flash** through `@google/generative-ai` with `responseMimeType=application/json`, low temperature, and a 1 M-token context (ample for ≈430 k-token inputs).
  4. Parses the JSON response, clamps confidences into `[0,1]`, dedupes `MarketKey`s, and assigns deterministic IDs to every cluster/edge before stamping `MatchGraph.version=1`.
  5. Persists the graph through `lib/match-graph-store.ts`, which mirrors the snapshot storage pattern: the graph is written to Upstash (`match-graph:latest`, TTL 24 h) and to disk (`data/match-graph.json` locally or `/tmp/match-graph/match-graph.json` on Vercel).
- `lib/match-graph-store.ts` also exposes `loadMatchGraph(maxAgeMs?)` so the bot (or any report) can pull the most recent graph using the same Redis→disk fallback logic as snapshots. Graph metadata tracks the model name plus per-platform market counts, making it easy to verify that the prompt contained full inventories.
- Configure `GOOGLE_GEMINI_API_KEY` in Vercel/CI secrets; without it the worker throws a descriptive error before issuing any network calls.
- Scheduled execution is defined in `vercel.json` via `{"path":"/api/match-graph/run","schedule":"0 5 * * *"}`. Vercel Cron runs that GET once per day at 05:00 UTC (midnight Eastern).
- Authentication: the endpoint requires `Authorization: Bearer <secret>` where `<secret>` is `MATCH_GRAPH_CRON_SECRET` (if set) otherwise `CRON_SECRET`. Vercel Cron should be configured with the same secret; manual runs can use `curl -X POST https://<host>/api/match-graph/run -H "Authorization: Bearer $MATCH_GRAPH_CRON_SECRET"`.
- `/api/match-graph/run` accepts both GET and POST. Cron jobs rely on GET; POST remains available for manual re-runs with optional `persist`/`maxMarkets` query parameters.
- `/api/match-graph/preview` is a GET-only route wired to the dashboard’s “Gemini Arbable Markets (On Demand)” card. It calls the same Gemini worker with `persist=false` by default, returns the fresh `MatchGraph` JSON (including `edges`) for inspection, and allows power users to opt into `?persist=true&maxMarkets=500` without touching the nightly cron output.
- `/api/match-graph/import` is a POST-only escape hatch for manual uploads. Operators paste the Gemini UI’s `[ { event_name, markets: [{ platform, id }] } ]` payload, the handler converts it into a canonical `MatchGraph`, and `saveMatchGraph` persists it to Upstash + disk with metadata noting the manual import.
- The dashboard’s “Manual Match Graph Import” card exposes a textarea + “Save manual match graph” button wired to the same endpoint so overwriting the live graph is a single-step, in-browser workflow (useful while Gemini API access is paused).
- `types/index.ts` now codifies the structure the bot consumes:

```
MatchGraph {
  version: 1;
  generatedAt: ISO timestamp;
  clusters: Array<{ id; label?; markets: MarketKey[] }>;
  edges: Array<{ id; type; markets: MarketKey[]; confidence; annotation? }>;
  metadata?: { model?: string; requestMarkets?: Record<platform, count>; notes?: string[] };
}
```

---

## 4. Background Snapshot Worker (`workers/snapshot-worker.ts`)

- Runs indefinitely (or via `npm run snapshot-worker`) and executes the following loop:
  1. Load `BotConfig` from KV to honor live settings (expiry window, market filters).
  2. Ask `MarketFeedService` for live markets per platform.
  3. Persist the normalized payloads via `saveMarketSnapshots`, which writes both to Upstash and the writable snapshot directory.
  4. Sleep for `SNAPSHOT_REFRESH_INTERVAL_MS` (default 20s, override with `SNAPSHOT_REFRESH_INTERVAL_MS` env).
- Gracefully handles SIGINT/SIGTERM and logs per-iteration timing.
- Failure in one platform does not block others—errors are logged, and the next iteration reuses the same filter set.
- Decouples “fetch and normalize” from “trade now,” so platform-specific outages no longer block the bot from trading on the remaining books.

---

## 5. Trading Bot (`lib/bot.ts`)

### Hot path (`scanAndExecute`)
1. Reads `BotConfig` and detailed balances (Kalshi/Polymarket totals, SX.bet cash).
2. Builds normalized filter preferences (window start/end, sports-only toggles) and calls `MarketFeedService.loadCachedMarkets`:
   - Prefers validated snapshots.
   - Falls back to live fetches if snapshots are stale or missing (with warnings so ops can address the worker).
   - Immediately persists those live payloads back into the snapshot store so subsequent cron runs stop hammering live APIs even if the worker is still down.
3. Logs per-platform counts and warns when a snapshot is empty.
   - Config + filter summaries, per-platform execution-window breakdowns, cross-platform candidate counts, and arbitrage scan stats are all emitted with `[BotConfig]`, `[MarketFilter]`, and `[ArbMatch]` tags so “Tracking 0 markets” situations can be diagnosed without digging into code.
4. Flows markets into `HotMarketTracker`, removes expired entries, and runs the two-stage arbitrage search (tracked combinations first, general cross-scan second).
5. Deduplicates opportunities, records scan metrics in `AdaptiveScanner`, and executes up to five best trades (simulation mode respects all logging but skips execution).
6. Writes detailed opportunity logs, bets, and arbitrage groups back into KV.

### Execution guarantees
- `isScanning` mutex prevents overlapping cron invocations.
- `AdaptiveScanner` adjusts scan cadence between 5s and 60s based on live-event signals and recent opportunity counts.
- `calculateBetSizes` enforces per-platform `maxBetPercentage` and available cash, while execution code double-checks expiry windows before sending orders.

---

## 6. Platform Integrations

### Kalshi (`lib/markets/kalshi.ts`, `services/kalshi.ts`)
- Authenticated requests use RSA-PSS signatures (`generateAuthHeaders`), and markets/orderbooks are public.
- Market fetch fixes:
  - Query params now use the documented `min_close_ts`/`max_close_ts` names (Unix seconds) plus `sort_by=close_time`.
  - Pagination matches adapter config (limit 200, 8 pages max).
- Balance helper consolidates cash + portfolio value, logging breakdowns for observability.
- Order placement supports FOK limit orders, using `buy_max_cost` and 10s expirations.

### Polymarket (`lib/markets/polymarket.ts`, `services/polymarket.ts`)
- Gamma-first ingestion with process-local caching and auto fallback to paginated CLOB sweeps when Gamma is empty.
- Gamma adapter now uses the documented `closed=false`, `end_date_min`, and `end_date_max` query params derived from `MarketFeedService` window filters so the server only returns markets inside the execution window.
- Gamma `/markets` pagination walks the `limit`/`offset` sequence, logging each page and continuing until Gamma returns fewer than `limit` rows, the configured `maxPages`, or the Polymarket `maxMarkets` cap (default ≈2000 tradable markets) is reached, so we routinely ingest multi-page (4+) batches when inventories are large.
- Normalizes outcomes, token IDs, and prices into `Market` objects, filtering out invalid or far-dated markets before they reach arbitrage logic.
- `derivePolymarketExpiry` favors `eventStartTime`/`gameStartTime` for sports and falls back to end/UMA dates for non-sports so sports inventories aren’t dropped, and the adapter logs per-scan expiry breakdowns plus samples of any skipped markets for observability.
- Order placement signs EIP-712 payloads and posts them to the CLOB order endpoint.

### SX.bet (`lib/markets/sxbet.ts`, `services/sxbet.ts`)
- Fetches `/markets/active` with `pageSize=50` and follows `paginationKey` → `nextKey` until the cursor is empty (or a `maxPages` safety cap hits) so we routinely ingest the full active universe (hundreds of markets depending on season).
- Derives expiry from `gameTime` and applies the same execution window the bot uses; cached stats log how many markets survive that filter plus how many hydrate with odds.
- `fetchBestOddsMap` hydrates top-of-book odds via `/orders/odds/best` (with the mainnet USDC base token), falling back to `/orders` when necessary—USDC filtering only happens at this odds layer per the docs.
- Odds are converted from SX.bet's percentage representation to decimal odds before populating `Market` entries, and adapter logs summarize per-page counts for observability.

All integrations return the shared `Market` interface so arbitrage logic remains platform-agnostic.

---

## 7. Storage & Configuration

| Store | Module | Usage |
|-------|--------|-------|
| **Vercel KV / Upstash** | `lib/kv-storage.ts` | Balances, configuration (including new `marketFilters` preferences), bets, arbitrage groups, opportunity logs, daily stats. |
| **Market snapshots** | `lib/market-snapshots.ts` | Schema-validated JSON (Upstash + disk) consumed by the bot. |
| **Market source config** | `lib/market-source-config.ts` | Authoritative schema describing adapters, filter bindings, doc links, and pagination knobs per platform. |
| **Match graph** | `lib/match-graph-store.ts` | Gemini-built `MatchGraph` (clusters + edges) stored in Upstash + disk for bot consumption. |
| **Local JSON** | `data/storage.json`, `data/bot-status.json`, `data/market-snapshots/*.json` | Dev defaults plus snapshot mirrors for offline debugging. |
| **GitHub storage** | `lib/github-storage.ts` | Historical data for the older long-running worker. |

`BotConfig` now includes `marketFilters` (sports-only toggle, category/event/league whitelists). The UI can safely expose these knobs knowing that adapters advertise exactly which filters they accept.

---

## 8. Risk, Pricing, and Execution Modules

- `lib/arbitrage.ts` / `lib/arbitrage-sportsbook.ts`: NLP-based market matching, profit calculation, dedupe logic.
- `lib/fees.ts`: Platform-specific fee curves (`calculateTotalCost`, `calculateArbitrageProfitMargin`).
- `lib/hot-market-tracker.ts`: Persistent cross-platform tracking to prioritize high-signal events.
- `lib/adaptive-scanner.ts`: Maintains rolling opportunity/liveness stats to tune scan cadence dynamically.
- `lib/email.ts`: Non-blocking low-balance alerts.
- Execution gates:
- Profit must exceed `config.minProfitMargin`.
- Markets must expire within `config.maxDaysToExpiry`.
  - Bet sizes are capped at `maxBetPercentage` of available cash per platform.
  - Simulation mode logs everything without hitting exchanges.

---

## 9. API Surface (`pages/api`)

| Endpoint | Purpose |
|----------|---------|
| `/api/bot/control`, `/api/bot/status`, `/api/bot/health`, `/api/bot/watchdog` | Bot lifecycle + watchdog endpoints. |
| `/api/bot/cron` | Invokes a single `scanOnce()` run (Vercel cron entry point). |
| `/api/balances`, `/api/balances/refresh` | Serve cached balances + trigger on-demand refresh. |
| `/api/bets`, `/api/opportunity-logs`, `/api/export`, `/api/export-opportunities` | Reporting endpoints powering dashboard exports. |
| `/api/config`, `/api/data` | Read/write bot configuration stored in KV. |
| `/api/snapshots/raw` | Streams the latest cached MarketSnapshot JSON (per platform) without hitting upstream vendors. |
| `/api/match-graph/run` | Gemini-powered daily matcher; builds/persists the latest `MatchGraph`. |

Each route reuses the same modules that power the bot/worker, so behavior stays consistent across deployment targets.

---

## 10. Observability & Tooling

- Snapshot validation logs point to the offending platform and field, making schema breaks immediately obvious.
- `logs.txt` captures recent bot runs (balances, page counts, adaptive scanner decisions) for regression debugging.
- `scripts/dump-markets.ts` can still backfill local snapshots, but the preferred path is running `npm run snapshot-worker`.
- `scripts/test-*` helpers verify authentication, parameter formatting, and market normalization for each platform.
- `scripts/test-sxbet-markets.ts --twice` runs two consecutive SX.bet fetches, persisting the first snapshot so the second run demonstrates odds reuse (watch `reusedOdds` climb while `/orders/odds/best` calls drop).
- `npm run test-polymarket-expiry` and `npm run test-snapshot-health` provide quick guards for the Polymarket expiry prioritization and snapshot freshness helpers respectively.
- `npm run test-cross-matching` exercises the semantic matcher across Kalshi, Polymarket, and sx.bet markets so “0 candidates” scenarios can be reproduced locally with deterministic fixtures.
- `/api/snapshots/debug` surfaces live snapshot diagnostics (source, age, schema) plus per-platform stats (`rawMarkets`, `withinWindow`, `hydratedWithOdds`, `stopReason`, `pagesFetched`, `writer`). Use it to confirm SX.bet is ingesting ≈2k markets; anything ≪100 means the snapshot worker is stale or pointing at the wrong Redis instance.
- `/api/snapshots/raw?platform=<id>` downloads the full cached snapshot JSON (Kalshi/Polymarket/SX.bet) so ops can diff payloads locally without shell access.
- SX.bet small-snapshot runbook: (1) hit `/api/snapshots/debug` and inspect the SX.bet row (`rawMarkets`, `stopReason`). (2) Ensure the snapshot-worker host runs the same commit + env vars as Vercel (KV + SX creds). (3) If needed, delete the `market-snapshots:sxbet` key once—on the next cron run the bot will flag the missing snapshot, fetch all `/markets/active` pages via the paginated adapter, record the counts in metadata, and self-heal Redis/disk automatically.

---

## 11. Deployment & Operations

- **Serverless runtime**: Next.js 14 on Vercel for the dashboard + API routes.
- **Bot cron**: Triggered via Vercel Scheduler hitting `/api/bot/cron`.
- **Snapshot worker**: Run `npm run snapshot-worker` (uses `esbuild-register`) on any Node host with the proper env; set `SNAPSHOT_REFRESH_INTERVAL_MS` if you need a slower cadence.
- **Environment requirements**: Kalshi API keys + private key (RSA-PSS), Polymarket CLOB keys + Polygon signer, SX.bet API key + wallet, Upstash Redis credentials, email SMTP.
- **Graceful degradation**: Missing credentials disable only the affected platform (e.g., SX.bet order placement remains TODO until permissions arrive), but snapshots and trading continue for the others.

---

## 12. Live-Event Arbitrage System

The live-event arbitrage subsystem provides real-time price streaming and low-latency opportunity detection for in-play/live markets. It runs alongside the existing snapshot + cron-bot architecture without replacing it.

### 12.1 Architecture Overview

| Component | Location | Purpose |
|-----------|----------|---------|
| **LivePriceCache** | `lib/live-price-cache.ts` | In-memory cache for real-time prices from WebSocket feeds |
| **LiveArbManager** | `lib/live-arb-manager.ts` | Orchestrates WS clients, subscription management, and arb detection |
| **LiveArbSafetyChecker** | `lib/live-arb-safety.ts` | Circuit breakers and safety checks for live execution |
| **LiveArbIntegration** | `lib/live-arb-integration.ts` | Integration hooks between live system and existing bot |
| **WebSocket Clients** | `services/sxbet-ws.ts`, `polymarket-ws.ts`, `kalshi-ws.ts` | Platform-specific WS connections |

### 12.2 LivePriceCache (`lib/live-price-cache.ts`)

- **In-memory, per-process cache** for real-time price data
- Stores prices by `{platform, marketId, outcomeId}` key
- Automatically tracks price age for staleness detection
- Separate storage for live scores (SX.bet only)
- **Multi-process behavior**: Each process maintains its own cache and WS connections. For multi-container deployments, run a dedicated live-arb worker with `LIVE_ARB_WORKER=true`.

Key methods:
- `updateLivePrice(update)`: Called by WS handlers to push new prices
- `getEffectivePrice(market, side, maxAgeMs)`: Returns live price if fresh, snapshot fallback otherwise
- `getEffectiveMarketPrices(market)`: Get both YES/NO with source indicators

### 12.3 WebSocket Clients

Each platform has a dedicated WebSocket client following the same pattern:

**Common features:**
- Connection state machine: `disconnected` → `connecting` → `connected` → `reconnecting` → `error`
- Exponential backoff reconnection (configurable base delay, max delay, max attempts)
- Heartbeat/ping to detect stale connections
- Subscription management with pending queue for pre-connection subscriptions
- State change handlers for monitoring

**SX.bet (`services/sxbet-ws.ts`)**
- Connects to SX.bet's real-time feed (may use Ably in production)
- Subscribes to global feeds: best-odds, live-scores, line-changes
- Also subscribes to individual markets via `subscribeToMarket(marketHash)`
- Handles odds updates, line changes, and score updates
- Converts SX.bet percentage odds (/ 10^20) to decimal odds

**Polymarket (`services/polymarket-ws.ts`)**
- Connects to Polymarket CLOB WebSocket
- Subscribes to orderbook updates and last trade prices per market
- Extracts best bid/ask to compute mid-prices
- Prices normalized to cents (0-100)

**Kalshi (`services/kalshi-ws.ts`)**
- Connects to Kalshi's WebSocket feed
- Subscribes to orderbook deltas and ticker updates
- Maintains local orderbook state to reconstruct from deltas
- Prices in cents (0-100)

### 12.4 Smart Subscription Management

To avoid subscribing to everything (thousands of markets), `LiveArbManager` implements intelligent subscription scoping:

1. **HotMarketTracker integration**: Only subscribes to markets that exist on 2+ platforms
2. **Debouncing**: Subscription updates are debounced (default 1s) to prevent thrashing
3. **Priority ordering**: Live events first, then by time-to-expiry
4. **Per-platform limits**: Configurable max subscriptions per platform (default 100)
5. **Live events only mode**: Optional filter via `LIVE_ARB_LIVE_EVENTS_ONLY=true`

Subscription flow:
```
HotMarketTracker populated → scheduleSubscriptionUpdate() → 
debounce timer → updateSubscriptions() → 
applySubscriptionChanges(platform, toAdd, toRemove)
```

### 12.5 Safety Checks & Circuit Breaker

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

**Integration with existing risk logic:**
- Live safety checks run **first** (fail fast on stale data)
- Then standard bot risk checks apply (expiry window, bet sizes)
- Both must pass for execution

### 12.6 SX.bet EIP-712 Order Signing

Full order placement is now implemented for SX.bet using EIP-712 signatures:

```typescript
// EIP-712 Domain
const SXBET_EIP712_DOMAIN = {
  name: 'SX.bet',
  version: '1.0',
  chainId: 4162, // SX Network
};

// Fill Order Types
const SXBET_FILL_ORDER_TYPES = {
  FillOrder: [
    { name: 'orderHash', type: 'bytes32' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'fillSalt', type: 'uint256' },
    { name: 'taker', type: 'address' },
    { name: 'baseToken', type: 'address' },
    { name: 'expiry', type: 'uint256' },
  ],
};
```

Order placement flow:
1. Fetch best orders for market via `getOrdersForMarket()`
2. Build fill order params with random salt
3. Sign using `wallet.signTypedData()` (ethers.js)
4. Submit to `/orders/fill` endpoint

Requires environment variables:
- `SXBET_PRIVATE_KEY`: Wallet private key for signing
- `SXBET_WALLET_ADDRESS`: Wallet address

### 12.7 Dashboard Monitoring

New API endpoints and UI for live arb monitoring:

**API Endpoints:**
- `GET /api/live-arb/status`: Overall status, WS connections, cache stats, circuit breaker
- `GET /api/live-arb/markets?platform=&liveOnly=&limit=`: Markets with live prices

**Dashboard page (`/live-arb`):**
- System status (enabled/ready/degraded)
- Per-platform connection indicators
- Price cache statistics
- Circuit breaker state
- Live markets table with prices and age
- Blocked opportunity counts by reason

### 12.8 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVE_ARB_ENABLED` | `false` | Enable live arb features |
| `LIVE_ARB_WORKER` | `false` | Designate as dedicated live arb worker |
| `LIVE_ARB_LIVE_EVENTS_ONLY` | `false` | Only monitor live events |
| `LIVE_ARB_MIN_PROFIT_BPS` | `50` | Minimum profit (basis points) |
| `LIVE_ARB_MAX_PRICE_AGE_MS` | `2000` | Max acceptable price age |
| `LIVE_ARB_MAX_LATENCY_MS` | `2000` | Max execution latency |
| `LIVE_ARB_MAX_SLIPPAGE_BPS` | `100` | Max slippage (basis points) |
| `LIVE_ARB_LOG_LEVEL` | `info` | Log level (`info` or `debug`) |
| `SXBET_WS_URL` | `wss://api.sx.bet/ws` | SX.bet WebSocket URL |
| `POLYMARKET_WS_URL` | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | Polymarket WS |

### 12.9 Testing

- `npm run test-live-ws`: Tests WebSocket connections to all platforms
- `npm run test-live-arb`: Runs a simulated live arb scan

---

## 13. Dry-Fire (Paper Trading) Mode

The dry-fire mode allows the system to run all arbitrage detection, pricing, and risk checks without placing real orders. This is essential for:

1. **Validation**: Verify opportunity detection logic before risking capital
2. **Tuning**: Collect data to adjust thresholds and parameters
3. **Monitoring**: Track potential profits and rejection reasons

### 13.1 Architecture Overview

| Component | Location | Purpose |
|-----------|----------|---------|
| **DryFireTradeLog Types** | `types/dry-fire.ts` | Type definitions for paper trade logs |
| **DryFireLogger** | `lib/dry-fire-logger.ts` | Persistence layer for paper trades |
| **ExecutionWrapper** | `lib/execution-wrapper.ts` | Routes between real and dry-fire execution |
| **Platform Guards** | `lib/markets/*.ts` | Belt-and-suspenders safety checks |

### 13.2 Configuration

Primary environment variable:

```
DRY_FIRE_MODE=true          # Master switch - when true, NO real orders placed
```

Optional fine-grained flags:

```
DRY_FIRE_LOG_OPPORTUNITIES=true    # Log all eligible opportunities
DRY_FIRE_LOG_REJECTED_REASON=true  # Include rejection reasons in logs
DRY_FIRE_MAX_LOGS=1000             # Maximum logs to keep
```

### 13.3 Execution Flow

```
Opportunity Detected
        │
        ▼
validateOpportunityForExecution()
        │
        ├─── REJECTED? ──► Log as REJECTED_BY_VALIDATION
        │
        ▼
calculateBetSizes()
        │
        ├─── Size too small? ──► Log as REJECTED_BY_RISK
        │
        ▼
checkDryFireMode()
        │
        ├─── DRY_FIRE=true ──► executeOpportunityDryFire()
        │                              │
        │                              ▼
        │                       logDryFireTrade(status: 'SIMULATED')
        │                              │
        │                              ▼
        │                       Return (no API calls)
        │
        └─── DRY_FIRE=false ──► executeOpportunityReal()
                                       │
                                       ▼
                                Platform placeBet() calls
```

### 13.4 Safety Guarantees

**Triple-layer protection ensures no orders are placed in dry-fire mode:**

1. **Wrapper Layer** (`lib/execution-wrapper.ts`):
   - `executeOpportunityWithMode()` checks `DRY_FIRE_MODE` first
   - Routes to `executeOpportunityDryFire()` which never calls platform APIs

2. **Guard Layer** (`lib/execution-wrapper.ts`):
   - `assertNotDryFire()` throws if called in dry-fire mode
   - Used as additional check in real execution path

3. **Platform Layer** (`lib/markets/*.ts`):
   - Each `placeBet()` method has its own guard
   - Returns error if `isDryFireMode()` is true
   - Prevents accidental calls even if wrapper is bypassed

### 13.5 DryFireTradeLog Schema

```typescript
interface DryFireTradeLog {
  id: string;
  createdAt: string;
  mode: 'DRY_FIRE';
  opportunityId: string;
  opportunityHash: string;
  legs: DryFireTradeLeg[];        // One per platform
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

### 13.6 Persistence

Dry-fire logs are stored using the same infrastructure as other KV data:

- **Primary**: Upstash Redis (`dry-fire:logs`, `dry-fire:stats`)
- **Fallback**: In-memory storage for development

Key functions in `lib/dry-fire-logger.ts`:
- `logDryFireTrade(log)`: Store a new paper trade
- `getDryFireLogs(options)`: Query logs with filters
- `getDryFireStats(since?)`: Get aggregated statistics
- `exportDryFireLogsToCSV(logs)`: Export to CSV format

### 13.7 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/live-arb/dry-fire-stats` | GET | Aggregated statistics |
| `/api/live-arb/dry-fire-export` | GET | CSV export with filters |

**Stats endpoint query parameters:**
- `since`: ISO timestamp filter
- `platform`: Filter by platform (kalshi, polymarket, sxbet)

**Export endpoint query parameters:**
- `since`, `platform`: Same as stats
- `status`: Filter by status (SIMULATED, REJECTED_BY_SAFETY, etc.)
- `limit`: Maximum logs to export

### 13.8 Dashboard Integration

The `/live-arb` dashboard page includes:

1. **Bot Control Panel**:
   - Start/Stop buttons for the live betting bot
   - Visual indicator when dry-fire mode is active
   - Clear warning that no real orders will be placed

2. **Dry-Fire Statistics Card**:
   - Count of simulated vs rejected trades
   - Breakdown by rejection reason
   - Total potential profit if all simulated trades executed
   - Profit distribution histogram

3. **CSV Export Panel**:
   - Download filtered trade logs
   - Select between all/simulated/rejected

### 13.9 Statistics Tracked

```typescript
interface DryFireStats {
  dryFireModeEnabled: boolean;
  totalSimulated: number;           // Would have executed
  totalRejectedBySafety: number;    // Failed safety checks
  totalRejectedByRisk: number;      // Failed risk checks
  totalRejectedByValidation: number;
  totalPotentialProfitUsd: number;
  avgProfitPerTradeUsd: number;
  profitBuckets: {                  // Profit distribution
    '0-25bps': number;
    '25-50bps': number;
    '50-100bps': number;
    '100-200bps': number;
    '200+bps': number;
  };
  byPlatform: Record<MarketPlatform, { simulated: number; rejected: number }>;
}
```

### 13.10 Usage Workflow

1. **Enable dry-fire mode**: Set `DRY_FIRE_MODE=true` in environment
2. **Start the bot**: Use dashboard or API
3. **Monitor**: Watch `/live-arb` for simulated trades
4. **Analyze**: Export CSV and review patterns
5. **Tune**: Adjust thresholds based on data
6. **Go live**: Set `DRY_FIRE_MODE=false` when confident

---

## 14. Rule-Based Live Sports Matcher

The rule-based live sports matcher provides deterministic cross-platform event matching for live sporting events. Unlike the Gemini-powered match graph (which handles broader market matching), this system focuses specifically on live/near-live sports events using simple, reliable heuristics.

### 14.1 Architecture Overview

| Component | Location | Purpose |
|-----------|----------|---------|
| **LiveEventRegistry** | `lib/live-event-registry.ts` | In-memory store of vendor events |
| **LiveEventMatcher** | `lib/live-event-matcher.ts` | Deterministic matching rules |
| **LiveEventWatchers** | `lib/live-event-watchers.ts` | Per-event arb monitoring |
| **LiveEventExtractors** | `lib/live-event-extractors.ts` | Vendor-specific event parsing |
| **LiveSportsOrchestrator** | `lib/live-sports-orchestrator.ts` | Main coordination module |

### 14.2 Matching Algorithm

**No AI/ML** - Pure deterministic heuristics:

1. **Sport Detection**: Pattern matching against known sports/league keywords
2. **Team Name Normalization**: Alias map for common variations (e.g., "Lakers" → "Los Angeles Lakers")
3. **Team Matching**: Jaccard similarity on normalized team names
4. **Time Tolerance**: Events must start within configurable window (default 15 min)

```
Event 1: "Lakers vs Celtics" (SX.bet)
Event 2: "LA Lakers @ Boston Celtics" (Polymarket)
Event 3: "NBA-LAKERS-CELTICS-2024" (Kalshi)

→ All normalize to: ["los angeles lakers", "boston celtics"]
→ Sport: NBA, Time: within tolerance
→ Match! Create MatchedEventGroup
```

### 14.3 Key Types

```typescript
interface VendorEvent {
  platform: 'SXBET' | 'POLYMARKET' | 'KALSHI';
  vendorMarketId: string;
  sport: Sport;
  homeTeam?: string;
  awayTeam?: string;
  teams: string[];
  startTime?: number;
  status: 'PRE' | 'LIVE' | 'ENDED';
  rawTitle: string;
}

interface MatchedEventGroup {
  eventKey: string;        // Canonical ID
  sport: Sport;
  homeTeam?: string;
  awayTeam?: string;
  vendors: {
    SXBET?: VendorEvent[];
    POLYMARKET?: VendorEvent[];
    KALSHI?: VendorEvent[];
  };
  platformCount: number;
  matchQuality: number;    // 0-1 confidence
}
```

### 14.4 Event Watchers (Hardened)

Watchers have been hardened with event-driven triggering and scoped arb checks:

**Key improvements:**
- **Event-driven**: Triggered by `LivePriceCache` price update callbacks, not blind 500ms polling
- **Scoped scans**: Each watcher ONLY evaluates markets in its `MatchedEventGroup`, not the entire universe
- **Debounced**: Rapid price updates are debounced (50ms) to prevent check storms
- **Instrumented**: Tracks timing metrics (avg/max check time, checks/sec)
- **Fallback polling**: 5-second safety net if WS is spotty

For each matched group with ≥2 platforms:

1. **Price Monitoring**: Subscribe to `LivePriceCache.onPriceUpdate()` for relevant markets
2. **Arb Detection**: Run `scanArbitrageOpportunities()` on event markets
3. **Execution**: Call `executeOpportunityWithMode()` (respects dry-fire mode)

```
MatchedEventGroup found
        │
        ▼
Start LiveEventWatcher
   - Register market IDs in marketIdToWatcher map
   - Subscribe to LivePriceCache.onPriceUpdate()
        │
        ▼
Price update received (event-driven)
        │
        ▼
Debounce (50ms)
        │
        ├── Already checking? → Skip
        ├── Rate limited? → Skip
        │
        ▼
getMarketsForGroup(group)  ← ONLY this event's markets!
        │
        ├── < 2 markets? → Skip
        │
        ▼
scanArbitrageOpportunities(groupMarkets)
        │
        ├── No opportunity? → Wait for next price update
        │
        ▼
Found opportunity!
        │
        ▼
executeOpportunityWithMode()
        │
        ├── DRY_FIRE_MODE=true → Log only
        └── DRY_FIRE_MODE=false → Execute trades

Fallback: 5s polling if WS is spotty
```

### 14.5 Rate Limiting

REST API calls are rate-limited per platform using a token bucket algorithm:

```typescript
// lib/rate-limiter.ts
const DEFAULT_RATE_LIMITS = {
  SXBET: { maxRequestsPerSecond: 5, bucketSize: 10 },
  POLYMARKET: { maxRequestsPerSecond: 5, bucketSize: 10 },
  KALSHI: { maxRequestsPerSecond: 5, bucketSize: 10 },
};

// Override via environment
SXBET_MAX_RPS=5
POLYMARKET_MAX_RPS=5
KALSHI_MAX_RPS=5
```

Usage in REST paths:
```typescript
import { acquireRateLimit } from './rate-limiter';

if (!acquireRateLimit('SXBET')) {
  console.log('[RateLimiter] SXBET rate limited, skipping request');
  return;
}
// Make request...
```

### 14.6 Vendor API Alignment

Field mappings in extractors follow official API docs:

| Platform | ID Field | Teams | Start Time | Status |
|----------|----------|-------|------------|--------|
| SX.bet | `marketHash` | `outcomeOneName/outcomeTwoName` | `gameTime` (seconds) | `status` (1-4) |
| Polymarket | `conditionId` | From title parsing | `gameStartTime` or `endDate` | `closed/resolved` |
| Kalshi | `ticker` | From title parsing | `close_time` | `status` (open/closed/settled) |

Each extractor includes `// NOTE:` comments linking to docs:
```typescript
// NOTE: Field mapping follows SX.bet docs: https://api.docs.sx.bet/
export function extractSxBetEvent(marketHash, title, metadata) { ... }
```

### 14.7 Supported Sports

| Sport | Key Patterns |
|-------|-------------|
| NBA | "nba", team nicknames |
| NFL | "nfl", "super bowl", team names |
| NHL | "nhl", "hockey", "stanley cup" |
| MLB | "mlb", "baseball", "world series" |
| EPL | "premier league", club names |
| UFC | "ufc", "mma" |
| NCAA_FB | "college football", "cfp" |
| NCAA_BB | "march madness", "ncaa basketball" |

### 14.8 Configuration

```bash
# Enable the rule-based matcher
LIVE_RULE_BASED_MATCHER_ENABLED=true

# Only match sports events (default true)
LIVE_RULE_BASED_SPORTS_ONLY=true

# Time tolerance for matching (ms)
LIVE_MATCH_TIME_TOLERANCE_MS=900000

# Max active watchers
LIVE_MAX_EVENT_WATCHERS=50

# Minimum platforms for a match
LIVE_MIN_PLATFORMS=2

# Refresh intervals
LIVE_REGISTRY_REFRESH_MS=30000
LIVE_MATCHER_INTERVAL_MS=10000
```

### 14.9 API Endpoint

`GET /api/live-arb/live-events`

Returns:
- Configuration snapshot (time tolerance, max watchers, etc.)
- Registry snapshot (all vendor events)
- Matched event groups with quality scores
- Active watchers with timing stats
- Rate limiter status
- Per-platform event breakdown

Query parameters:
- `liveOnly=true`: Only live events
- `minPlatforms=3`: Require 3+ platforms
- `sport=NBA`: Filter by sport
- `limit=100`: Max groups to return

### 14.10 Dashboard Integration

The `/live-arb` page displays:

- **Rule-Based Matcher Card**: 
  - Running status and uptime
  - Event counts by status (live/pre) and platform
  - Match quality (3-way vs 2-way matches)
  - Config summary (time tolerance, max watchers)
  - Watcher performance (avg/max check time, checks/sec)
- **Matched Events Table**: Cross-platform matches with sport, teams, platforms, quality

### 14.11 Coexistence with HotMarketTracker

This system runs **alongside** (not replacing) the existing architecture:

| System | Scope | Method |
|--------|-------|--------|
| HotMarketTracker | All markets | NLP + Gemini |
| Rule-Based Matcher | Live sports only | Deterministic |

Both feed into the same:
- `LivePriceCache` for prices
- `executeOpportunityWithMode()` for execution
- Dry-fire logging system

---

## 15. Future Work Hooks

- New adapters can be added by dropping a `MarketAdapterConfig` entry + handler (`MarketFeedService` already supports adapter-type dispatch).
- Snapshot schema versioning makes it safe to evolve fields without breaking the bot—old data fails validation and is ignored.
- `marketFilters` is plumbed through config/UI, so exposing controls like "sports-only" or league-specific feeds now requires zero code changes in the adapters—just update the Upstash config entry.
- **Distributed price cache**: For multi-container deployments at scale, the in-memory `LivePriceCache` could be backed by Redis pub/sub for shared state.
- **Additional WS platforms**: The WS client pattern is designed to be extensible for new platforms.
- **Dry-fire analytics**: Add time-series analysis of paper trades to identify optimal trading windows.
- **A/B threshold testing**: Run multiple parameter sets in parallel dry-fire mode to compare performance.
- **Extended team alias map**: Add more team name variations as observed in production logs.
- **Sport-specific matching rules**: Customize matching logic per sport (e.g., stricter for props).

This architecture keeps trading logic centralized, decouples market ingestion from execution, and documents every platform-specific switch in a single, schema-validated location.
