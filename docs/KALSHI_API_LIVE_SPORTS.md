# Kalshi API: Live Sports Markets Discovery

This document explains how we work with the Kalshi API to discover currently-live sports markets without scanning all 30,000+ markets.

## Overview

Kalshi offers prediction markets on various sports events including game winners, spreads, and totals. The challenge is efficiently finding **live** markets (games currently in progress) without crawling the entire market catalog.

## API Endpoints Used

### 1. Events Endpoint

```
GET /trade-api/v2/events
```

**Purpose:** Fetch events (games) for a specific sports series.

**Key Parameters:**
| Parameter | Description |
|-----------|-------------|
| `series_ticker` | Filter by sports series (e.g., `KXNFLGAME`) |
| `status` | Filter by status (`open`, `closed`, etc.) |
| `limit` | Max events to return (default: 100) |
| `with_nested_markets` | Include market data in response (`true`/`false`) |

**Example Request:**
```bash
GET /events?series_ticker=KXNFLGAME&status=open&limit=100&with_nested_markets=true
```

**Example Response:**
```json
{
  "events": [
    {
      "event_ticker": "KXNFLGAME-25DEC20PHIWAS",
      "title": "Philadelphia at Washington",
      "series_ticker": "KXNFLGAME",
      "markets": [
        {
          "ticker": "KXNFLGAME-25DEC20PHIWAS-PHI",
          "title": "Philadelphia at Washington Winner?",
          "status": "active",
          "expected_expiration_time": "2025-12-21T01:00:00Z",
          "yes_price": 67,
          "no_price": 33
        }
      ]
    }
  ]
}
```

### 2. Markets Endpoint

```
GET /trade-api/v2/markets
```

**Purpose:** Fetch individual markets (used as fallback if nested markets aren't available).

**Key Parameters:**
| Parameter | Description |
|-----------|-------------|
| `event_ticker` | Filter by event ticker |
| `series_ticker` | Filter by series ticker |
| `status` | Filter by status (`open`, `active`) |
| `limit` | Max markets to return |

## Sports Series Tickers

Kalshi organizes sports markets into **series**. Each series has a unique ticker prefix:

### Major US Sports
| Series Ticker | Sport |
|---------------|-------|
| `KXNFLGAME` | NFL Football |
| `KXNBAGAME` | NBA Basketball |
| `KXNHLGAME` | NHL Hockey |
| `KXMLBGAME` | MLB Baseball |
| `KXWNBAGAME` | WNBA Basketball |
| `KXMLSGAME` | MLS Soccer |

### College Sports
| Series Ticker | Sport |
|---------------|-------|
| `KXNCAAFGAME` | College Football (FBS) |
| `KXNCAABGAME` | College Basketball (Men's) |
| `KXNCAAWGAME` | College Basketball (Women's) |

### Soccer / Football
| Series Ticker | League |
|---------------|--------|
| `KXEPLGAME` | English Premier League |
| `KXLALIGAGAME` | La Liga (Spain) |
| `KXBUNDESLIGAGAME` | Bundesliga (Germany) |
| `KXSABORAGAME` | Serie A (Italy) |
| `KXLIGUE1GAME` | Ligue 1 (France) |
| `KXUCLGAME` | UEFA Champions League |
| `KXLIGAMXGAME` | Liga MX (Mexico) |

### Combat Sports
| Series Ticker | Sport |
|---------------|-------|
| `KXUFCFIGHT` | UFC |
| `KXBOXING` | Boxing |
| `KXMMAFIGHT` | MMA (Generic) |
| `KXPFL` | PFL |
| `KXBELLATOR` | Bellator |

### Individual Sports
| Series Ticker | Sport |
|---------------|-------|
| `KXTENNIS` | Tennis |
| `KXGOLF` | Golf |
| `KXPGATOUR` | PGA Tour |
| `KXF1RACE` | Formula 1 |
| `KXNASCAR` | NASCAR |

### Esports
| Series Ticker | Game |
|---------------|------|
| `KXLOLGAME` | League of Legends |
| `KXCSGOGAME` | CS:GO |
| `KXDOTA2GAME` | Dota 2 |

## Event Ticker Format

Event tickers follow a predictable format that encodes the game date:

```
{SERIES}-{YY}{MON}{DD}{TEAMS}
```

**Examples:**
- `KXNFLGAME-25DEC20PHIWAS` → NFL game on Dec 20, 2025: Philadelphia at Washington
- `KXNBAGAME-25DEC20HOUDEN` → NBA game on Dec 20, 2025: Houston vs Denver
- `KXNCAAFGAME-25DEC20TULNMISS` → College football on Dec 20, 2025: Tulane at Ole Miss

**Date Parsing:**
- `25` = Year 2025
- `DEC` = December
- `20` = Day 20
- `PHIWAS` = Team codes (PHI = Philadelphia, WAS = Washington)

## Market Structure

Each game event typically has **2 markets** (one for each team to win):

```
Event: KXNFLGAME-25DEC20PHIWAS (Philadelphia at Washington)
├── Market: KXNFLGAME-25DEC20PHIWAS-PHI (Philadelphia wins?)
│   ├── yes_price: 67 (67% implied probability)
│   └── no_price: 33
└── Market: KXNFLGAME-25DEC20PHIWAS-WAS (Washington wins?)
    ├── yes_price: 33 (33% implied probability)
    └── no_price: 67
```

## Key Timing Fields

### The Critical Field: `expected_expiration_time`

The most important field for live detection is **`expected_expiration_time`** on the market object. This represents when Kalshi expects the game to **END** and the market to be settled.

| Field | Description | Use for Live Detection |
|-------|-------------|------------------------|
| `expected_expiration_time` | When the game is expected to END | ✅ **Primary signal** |
| `open_time` | When trading opened | ❌ Days before game |
| `close_time` | Latest settlement time | ❌ Weeks after game |
| `expiration_time` | Same as close_time | ❌ Not useful |

### Example Timing (NFL Game at 8:00 PM EST):
```json
{
  "ticker": "KXNFLGAME-25DEC20PHIWAS-PHI",
  "open_time": "2025-12-09T02:06:00Z",           // 11 days before
  "expected_expiration_time": "2025-12-21T01:00:00Z",  // ~8 PM + 4 hours = midnight
  "close_time": "2026-01-03T22:00:00Z"           // 2 weeks after (settlement window)
}
```

## Live Detection Strategy

### The Algorithm

A game is **LIVE** if the current time falls within the estimated game window:

```
estimated_start = expected_expiration_time - game_duration
game_is_live = (estimated_start - buffer) <= now <= (expected_expiration_time + buffer)
```

### Sport-Specific Game Durations

| Sport | Typical Duration |
|-------|------------------|
| NFL Football | 4 hours |
| College Football | 4 hours |
| NBA Basketball | 3 hours |
| College Basketball | 2.5 hours |
| NHL Hockey | 3 hours |
| MLB Baseball | 3.5 hours |
| Soccer | 2 hours |
| Boxing/UFC | 4 hours |

### Implementation

```typescript
const GAME_DURATION_HOURS: Record<string, number> = {
  'KXNFLGAME': 4,
  'KXNBAGAME': 3,
  'KXNHLGAME': 3,
  'KXNCAAFGAME': 4,
  'KXNCAABGAME': 2.5,
  'KXEPLGAME': 2,
  'DEFAULT': 3,
};

const LIVE_BUFFER_HOURS = 1; // Account for delays/overtime

function isLiveEvent(event: KalshiEvent, now: Date): boolean {
  const market = event.markets?.[0];
  if (!market || market.status !== 'active') return false;
  
  const expectedEnd = new Date(market.expected_expiration_time);
  const gameDuration = GAME_DURATION_HOURS[event.series_ticker] || 3;
  const estimatedStart = new Date(expectedEnd.getTime() - gameDuration * 3600000);
  
  const startWindow = estimatedStart.getTime() - LIVE_BUFFER_HOURS * 3600000;
  const endWindow = expectedEnd.getTime() + LIVE_BUFFER_HOURS * 3600000;
  
  return now.getTime() >= startWindow && now.getTime() <= endWindow;
}
```

### Why This Works Better Than Date Parsing

| Method | Pros | Cons |
|--------|------|------|
| **Ticker Date Parsing** | Simple | Includes games later today that haven't started; misses late-night games |
| **`expected_expiration_time`** | Precise timing; accounts for actual game schedule | Requires game duration estimate |

### Example: Dec 20, 2025 at 6:40 PM EST (23:40 UTC)

| Event | Expected End | Estimated Start | Status |
|-------|--------------|-----------------|--------|
| PHI @ WAS (8 PM game) | Dec 21 01:00 UTC | Dec 20 21:00 UTC | ✅ LIVE (within window) |
| GB @ CHI (4 PM game) | Dec 21 00:00 UTC | Dec 20 20:00 UTC | ✅ LIVE |
| BOS @ TOR (5 PM game) | Dec 21 00:30 UTC | Dec 20 21:30 UTC | ✅ LIVE |
| LA @ ATL (Dec 29 game) | Dec 30 04:15 UTC | Dec 30 00:15 UTC | ❌ Not yet |

## Authentication

Kalshi uses RSA-PSS signature authentication:

```typescript
const timestamp = Date.now().toString();
const message = `${timestamp}GET/trade-api/v2/events?series_ticker=KXNFLGAME`;

const signature = crypto.sign('sha256', Buffer.from(message), {
  key: privateKey,
  padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
  saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
}).toString('base64');

const headers = {
  'KALSHI-ACCESS-KEY': apiKey,
  'KALSHI-ACCESS-SIGNATURE': signature,
  'KALSHI-ACCESS-TIMESTAMP': timestamp,
};
```

## Rate Limiting

Kalshi enforces rate limits. Best practices:
- Add 150-200ms delay between requests
- Handle 429 responses with exponential backoff
- Use `with_nested_markets=true` to reduce request count

## Example: Fetching Live Sports Markets

```typescript
const SPORTS_SERIES = ['KXNFLGAME', 'KXNBAGAME', 'KXNHLGAME', ...];

async function fetchLiveSportsMarkets() {
  const allEvents = [];
  
  for (const series of SPORTS_SERIES) {
    const response = await kalshiGet('/events', {
      series_ticker: series,
      limit: 100,
      with_nested_markets: 'true',
    });
    allEvents.push(...response.events);
    await delay(200); // Rate limiting
  }
  
  // Filter to live games using expected_expiration_time
  const now = new Date();
  const liveEvents = allEvents.filter(e => isLiveEvent(e, now));
  
  // Extract markets
  const markets = liveEvents.flatMap(e => e.markets || []);
  
  return { liveEvents, markets };
}
```

## Test Script

Run the live discovery test:

```bash
npm run test:kalshi-live
```

This outputs:
- Number of series queried
- Events found per series
- Live events (games in progress)
- Markets available for trading

Output is saved to `data/kalshi-live-snapshot.json`.

## Limitations

1. **No real-time game state:** Kalshi doesn't expose "2Q - 00:25" or similar game clock info via API
2. **Game duration estimates:** We estimate when games started based on typical durations; unusual games (overtime, delays) may be misclassified
3. **Series availability:** Not all series tickers are always active (e.g., MLB only during season)
4. **Rate limits:** Must throttle requests to avoid 429 errors
5. **Time zones:** All Kalshi times are UTC; local time zone handling is important

## See Also

- [Kalshi API Documentation](https://docs.kalshi.com)
- [Authentication Guide](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)
- Test file: `tests/kalshi.live.discovery.test.ts`
