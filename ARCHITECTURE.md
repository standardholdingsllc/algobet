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

### 3.4 Self-healing snapshot seeding

- `MarketFeedService.loadCachedMarkets` can optionally persist live fallback payloads back to the snapshot store. This self-healing mode is gated behind an internal token that is only attached when `buildFiltersFromConfig` is used, preventing debug scripts from overwriting canonical snapshots with ad-hoc filters.
- The cron bot enables `persistOnFallback` with the same filters the snapshot worker would use. The very first cron run in a brand-new environment therefore seeds `market-snapshots:*` in Upstash (and `/tmp/market-snapshots/*.json` on disk) even if `npm run snapshot-worker` isn’t running yet. Subsequent runs immediately benefit from cached payloads.
- The snapshot worker remains the primary, always-on refresher. The bot’s persistence is intentionally opportunistic—it keeps trading when caches are cold and gives operators breathing room to restart the worker.

**Verification flow**
1. Trigger one bot invocation (e.g., hit `/api/bot/cron` via Vercel Scheduler or run `curl -X POST https://<deployment>/api/bot/cron` locally with the right auth headers).
2. Call `/api/snapshots/debug` in the same environment (dashboard button or `curl https://<deployment>/api/snapshots/debug`).
3. Confirm each platform shows a Redis or disk snapshot with:
   - `schemaVersion=2`
   - `filters.windowStart/windowEnd` that match the active `BotConfig` window (≈ `maxDaysToExpiry`)
   - Adapter IDs that reflect the active registry (`kalshi:markets`, `polymarket:hybrid`, etc.)
4. Start (or keep running) `npm run snapshot-worker` on your long-lived Node host. Watch its `[SnapshotWorker] Saved snapshot ...` logs to verify it keeps refreshing the same keys and directories; the bot will automatically fall back to the worker-provided snapshots on subsequent scans.

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

Each route reuses the same modules that power the bot/worker, so behavior stays consistent across deployment targets.

---

## 10. Observability & Tooling

- Snapshot validation logs point to the offending platform and field, making schema breaks immediately obvious.
- `logs.txt` captures recent bot runs (balances, page counts, adaptive scanner decisions) for regression debugging.
- `scripts/dump-markets.ts` can still backfill local snapshots, but the preferred path is running `npm run snapshot-worker`.
- `scripts/test-*` helpers verify authentication, parameter formatting, and market normalization for each platform.
- `npm run test-polymarket-expiry` and `npm run test-snapshot-health` provide quick guards for the Polymarket expiry prioritization and snapshot freshness helpers respectively.
- `npm run test-cross-matching` exercises the semantic matcher across Kalshi, Polymarket, and sx.bet markets so “0 candidates” scenarios can be reproduced locally with deterministic fixtures.
- `/api/snapshots/debug` surfaces live snapshot diagnostics (source, age, schema) for each platform, making it easy to confirm whether the bot is reading Redis or disk and why a snapshot might be skipped.

---

## 11. Deployment & Operations

- **Serverless runtime**: Next.js 14 on Vercel for the dashboard + API routes.
- **Bot cron**: Triggered via Vercel Scheduler hitting `/api/bot/cron`.
- **Snapshot worker**: Run `npm run snapshot-worker` (uses `esbuild-register`) on any Node host with the proper env; set `SNAPSHOT_REFRESH_INTERVAL_MS` if you need a slower cadence.
- **Environment requirements**: Kalshi API keys + private key (RSA-PSS), Polymarket CLOB keys + Polygon signer, SX.bet API key + wallet, Upstash Redis credentials, email SMTP.
- **Graceful degradation**: Missing credentials disable only the affected platform (e.g., SX.bet order placement remains TODO until permissions arrive), but snapshots and trading continue for the others.

---

## 12. Future Work Hooks

- New adapters can be added by dropping a `MarketAdapterConfig` entry + handler (`MarketFeedService` already supports adapter-type dispatch).
- Snapshot schema versioning makes it safe to evolve fields without breaking the bot—old data fails validation and is ignored.
- `marketFilters` is plumbed through config/UI, so exposing controls like “sports-only” or league-specific feeds now requires zero code changes in the adapters—just update the Upstash config entry.

This architecture keeps trading logic centralized, decouples market ingestion from execution, and documents every platform-specific switch in a single, schema-validated location.
