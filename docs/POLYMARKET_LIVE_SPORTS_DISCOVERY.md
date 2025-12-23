# Polymarket Live Sports Markets Discovery

This document explains the integration test for discovering **currently-live sports markets** on Polymarket using the Gamma API.

## Overview

The test (`tests/polymarket.live.discovery.test.ts`) discovers in-play sports markets on Polymarket without crawling all markets. It uses targeted API queries and sports-specific filters to efficiently find live games.

## How to Run

```bash
npm run test:poly-live
```

## What "LIVE" Means

A market is considered **LIVE** (in-play) when:

1. **Sports market**: Has a `sportsMarketType` field (e.g., `moneyline`, `spreads`, `totals`)
2. **Game started**: `gameStartTime` or event `startTime` is in the past (with 15-min tolerance)
3. **Game not ended**: Start time is within the last 6 hours (configurable)
4. **Tradable**: Market is `active=true` and `closed=false`

### Why NOT These Indicators

During API exploration, we found that these fields are **NOT reliable** for live detection:

| Field | Why Not Reliable |
|-------|------------------|
| `fpmmLive` | Always undefined/false on current markets |
| `acceptingOrders` | True for ALL active markets, not just live ones |
| `endDate` proximity | Many markets have endDates weeks after the game |
| `gameStatus` | Not populated on events |

## API Strategy

### Key Discovery: `event_date` Filter

The breakthrough was discovering that the `/events` endpoint supports an `event_date` filter that returns **only sports events for a specific day**:

```
GET /events?event_date=2025-12-21&active=true&closed=false&limit=100
```

This returns events like:
- "Rockets vs. Nuggets" (startTime: 2025-12-20T22:00:00Z)
- "Mavericks vs. 76ers" (startTime: 2025-12-21T00:00:00Z)

Each event includes nested markets with:
- `gameStartTime`: When the game starts
- `sportsMarketType`: Type of sports bet (moneyline, spreads, totals, etc.)

### UTC Date Boundary Handling

**Important**: Games that start late evening in US timezones (e.g., 10 PM EST = 03:00 UTC next day) will have the previous day's `event_date` in UTC. To catch all live games, the test queries **both today and yesterday**:

```typescript
const datesToQuery = [today, yesterday];  // e.g., ['2025-12-21', '2025-12-20']
```

This ensures games like "Rockets vs Nuggets" (started 10 PM EST on Dec 20th = 03:00 UTC Dec 21st) are found even when running the test after midnight UTC.

### Request Flow

1. **GET /sports** - Discover sport configurations (94 sports)
2. **GET /events?event_date=today** - Get today's sports events (paginated)
3. **GET /events?event_date=yesterday** - Get yesterday's sports events (for UTC boundary)
4. Filter to events where `startTime <= now` and `startTime + 6h >= now`
5. Extract markets with `sportsMarketType`

### Guardrails (No Crawling)

The test enforces strict limits to prove we're not scanning all markets:

| Guardrail | Limit |
|-----------|-------|
| API requests | ≤ 25 |
| Events fetched | ≤ 2,000 |
| Markets inspected | ≤ 10,000 |
| Live markets returned | ≤ 500 |

Typical run with live games: **5 requests**, **370 events**, **2,371 markets inspected**, **494 live markets found**.

## Output Snapshot

The test writes `data/polymarket-live-snapshot.json` containing:

```json
{
  "generatedAt": "2025-12-21T00:25:58.194Z",
  "config": { ... },
  "sportsDiscovered": [
    { "code": "nfl", "name": "NFL", "seriesId": "10187", "tagIds": ["1", "450", "100639"] },
    { "code": "nba", "name": "NBA", "seriesId": "10345", "tagIds": ["1", "100639", "100380"] },
    ...
  ],
  "counts": {
    "requestsMade": 4,
    "eventsFetched": 270,
    "marketsInspected": 1469,
    "marketsWithSportsType": 1469,
    "marketsLiveFiltered": 0
  },
  "liveMarkets": [ ... ],
  "debug": {
    "uniqueSportsMarketTypes": ["moneyline", "spreads", "totals", ...],
    "nearMisses": [
      { "title": "Will FC Utrecht win...", "reason": "Starts in future (2025-12-21T11:15:00Z)" }
    ]
  }
}
```

## Sports Market Types

The API returns these `sportsMarketType` values:

| Type | Description |
|------|-------------|
| `moneyline` | Win/lose/draw |
| `spreads` | Point spread |
| `totals` | Over/under total points |
| `first_half_spreads` | 1st half point spread |
| `first_half_totals` | 1st half over/under |
| `first_half_moneyline` | 1st half win |
| `team_totals` | Team-specific over/under |
| `anytime_touchdowns` | Player props - TDs |
| `rushing_yards` | Player props - rushing |
| `receiving_yards` | Player props - receiving |
| `points` | Player points |
| `rebounds` | Player rebounds |
| `assists` | Player assists |
| `tennis_*` | Tennis-specific markets |
| `cricket_*` | Cricket-specific markets |

## Configuration Constants

Tune these in `tests/polymarket.live.discovery.test.ts`:

```typescript
// Pagination
const MAX_PAGES = 5;
const EVENTS_PER_PAGE = 100;
const EARLY_STOP_LIVE_MARKETS = 200;

// Live detection
const MAX_GAME_DURATION_HOURS = 6;
const GAME_START_FUTURE_TOLERANCE_MINUTES = 15;

// Guardrails
const MAX_REQUESTS = 20;
const MAX_EVENTS_FETCHED = 1000;
const MAX_MARKETS_INSPECTED = 5000;
const MAX_LIVE_MARKETS_FILTERED = 500;
```

## Expected Results

### When Games Are Live

If games are in progress, you'll see:

```
📊 Summary:
   Sports discovered: 94
   Pages fetched: 4
   Events fetched: 370
   Events with startTime in past: 78
   Markets inspected: 2371
   Markets with sportsMarketType: 2371
   LIVE markets found: 494
   Requests made: 5

🔴 Sample LIVE markets:
   1. [moneyline] Rockets vs. Nuggets...
      gameStart: 2025-12-20 22:00:00+00
   2. [spreads] Spread: Nuggets (-1.5)...
      gameStart: 2025-12-20 22:00:00+00
   3. [moneyline] Islanders vs. Sabres...
      gameStart: 2025-12-20 22:00:00+00
```

### When No Games Are Live

If no games are currently in progress (common late at night or early morning):

```
⚠️ No LIVE sports markets found at this time.
   This is expected if no games are currently in progress.
   Events today: 270
   Events with startTime in past: 0

   Near misses (why markets aren't live):
   1. Will FC Utrecht win on 2025-12-21?
      Reason: Starts in future (2025-12-21T11:15:00Z)
```

## Files

| File | Purpose |
|------|---------|
| `tests/polymarket.live.discovery.test.ts` | Main test file |
| `tests/utils/polymarketGamma.ts` | Gamma API helper |
| `data/polymarket-live-snapshot.json` | Output snapshot |

## API Reference

Based on [Polymarket Gamma API Documentation](https://docs.polymarket.com/developers/gamma-markets-api/overview):

### Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /sports` | Get sport configurations with series IDs and tag IDs |
| `GET /events` | Get events with nested markets |

### Key Query Parameters

| Parameter | Description |
|-----------|-------------|
| `event_date` | Filter events by date (YYYY-MM-DD) |
| `active` | Filter to active events/markets |
| `closed` | Filter out closed events/markets |
| `limit` | Page size |
| `offset` | Pagination offset |

## Limitations

1. **No real "in-play" indicator**: Polymarket doesn't expose a field that says "game is currently in progress." We infer it from `startTime` being in the past.

2. **Game duration estimation**: We assume games last up to 6 hours. This may exclude overtime or extra innings scenarios.

3. **Time zone handling**: All times are in UTC. The `event_date` filter uses UTC date.

4. **Market closure timing**: Some markets may close before the game ends (e.g., halftime markets).

## Future Improvements

- Add sport-specific game duration estimates (NFL: 4h, NBA: 3h, soccer: 2h)
- Cross-reference with external sports APIs for actual game status
- Add WebSocket integration for real-time price updates on live markets

