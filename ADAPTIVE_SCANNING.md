# Adaptive Scanning System

## Overview

AlgoBet uses an intelligent adaptive scanning system that adjusts scan frequency based on market conditions. This maximizes arbitrage detection during live events while conserving API calls during quiet periods.

## Scanning Modes

### 🔴 LIVE EVENT MODE: 5 Seconds
**Triggers**: Active sports games (sx.bet markets in-play)

**Why**: 
- Odds change every few seconds during live games
- Arbitrage windows last 10-60 seconds
- Need to catch opportunities before they close

**Example**:
```
Lakers vs Celtics game is LIVE
→ Scan every 5 seconds
→ 720 scans per hour
→ Catch rapid odds movements
```

**API Calls per Hour**:
- 720 scans × 5 API calls = 3,600 calls/hour
- Still within rate limits (careful monitoring needed)

### ⚡ HIGH ACTIVITY MODE: 10 Seconds
**Triggers**: 
- Recent opportunities found (last 5 scans)
- Recent activity score > 3

**Why**:
- Markets are volatile
- More opportunities likely to appear
- Balance speed vs API usage

**Example**:
```
Found 2 arbitrage opportunities in last minute
→ Scan every 10 seconds
→ 360 scans per hour
→ Higher chance of finding more
```

### 📊 NORMAL MODE: 30 Seconds (Default)
**Triggers**: 
- No live events detected
- No recent high activity

**Why**:
- Good balance for most conditions
- Prediction markets don't move that fast
- Reasonable API usage
- **NOTE**: Markets are 24/7 global - no time-based logic!

**Example**:
```
No live events detected globally
→ Scan every 30 seconds
→ 120 scans per hour
→ Standard arbitrage detection
```

### 🌍 Global 24/7 Reality

**Important**: The bot **NO LONGER uses time-of-day logic**. Why?

- **3am NYC** = Soccer in Europe (peak time)
- **3am London** = Tennis in Asia
- **3am Tokyo** = MLB/NBA in USA
- **Crypto** = Never sleeps

There is **no "quiet period"** - sports happen globally around the clock. The bot now detects live events based purely on **market characteristics**:

1. ✅ Sportsbook markets expiring within 3 hours
2. ✅ Markets with "live" keywords expiring within 6 hours  
3. ✅ Any market expiring within 1 hour

## How It Works

### Adaptive Decision Flow

```
Every scan:
├─ Check for live events (market-based detection)
│  ├─ Sportsbook markets expiring within 3 hours?
│  ├─ Markets with "live" keywords expiring within 6 hours?
│  └─ Any market expiring within 1 hour?
│  └─ YES → Set interval to 5 seconds
│
├─ Check recent opportunities found
│  └─ Found 1+ in last 5 scans → Set interval to 10 seconds
│
├─ Default (no live events, no recent activity)
│  └─ Set interval to 30 seconds
│
└─ Wait for calculated interval before next scan

Note: NO time-of-day logic! Markets are global and 24/7.
```

### Example Timeline

```
Time    Mode        Interval    Event
────────────────────────────────────────────────
2:00pm  NORMAL      30s         Standard scanning
2:15pm  NORMAL      30s         Found 1 opportunity
2:16pm  HIGH        10s         High activity detected
2:20pm  NORMAL      30s         Activity normalized
7:00pm  LIVE        5s          Lakers game starts (expires in 3h)
9:30pm  LIVE        5s          Game still ongoing
10:00pm HIGH        10s         Game ended, high volatility
10:10pm NORMAL      30s         Markets stabilized
3:00am  LIVE        5s          European soccer detected (expires 5:30am)
5:45am  NORMAL      30s         No live events globally
```

## Live Event Detection

### Market-Based Detection (Global 24/7)

The bot detects live events by analyzing market characteristics, **NOT time of day**:

**Detection Criteria:**

1. **Sportsbook markets expiring within 3 hours**  
   → Likely live or starting very soon (sx.bet games)

2. **Markets with "live" keywords + expiring within 6 hours**  
   → Keywords: live, inplay, quarter, half, tonight, today, now

3. **Any market expiring within 1 hour**  
   → Imminent resolution regardless of type

```typescript
function detectLiveEvents(markets) {
  for each market:
    // Sportsbook markets expiring soon
    if marketType === 'sportsbook' && expiresIn <= 3 hours:
      liveEventsCount++
    
    // Live keywords + short expiry
    if hasLiveKeyword && expiresIn <= 6 hours:
      liveEventsCount++
    
    // Very short expiry (any type)
    if expiresIn <= 1 hour:
      liveEventsCount++
  
  return liveEventsCount
}
```

### Example Detection (3am NYC)

```
Current time: 3:00am NYC (8am London, 4pm Tokyo)

Markets:
- ⚽ Premier League: Chelsea vs Arsenal (expires 10am NYC) ✅ LIVE
- 🎾 Australian Open (expires 5am NYC) ✅ LIVE  
- 📊 Bitcoin price (expires in 2 days) ❌ Not imminent
- 🏀 NBA game tonight (expires 11pm NYC) ❌ Too far out

Result: 2 live events → LIVE MODE (5 second scanning)
```

**Key**: Even at 3am in one timezone, there are always live events globally!

## API Rate Limits

### Current Limits

| Platform | Rate Limit | Our Usage (Normal) | Usage (Live) |
|----------|------------|-------------------|--------------|
| Kalshi | ~100/min | ~6/min | ~60/min |
| Polymarket | ~60/min | ~4/min | ~40/min |
| sx.bet | ~100/min | ~4/min | ~48/min |

### Safety Margins

**Normal Mode (30s)**:
- 14 API calls/min
- ✅ Very safe (14% of limits)

**High Activity (10s)**:
- 42 API calls/min
- ✅ Safe (42% of limits)

**Live Events (5s)**:
- 84 API calls/min
- ⚠️ Watch closely (84% of limits)
- Still under limits but monitor for errors

### Mitigation Strategies

If hitting rate limits during live events:

1. **Increase live event interval** to 7-8 seconds
2. **Stagger API calls** (don't call all at once)
3. **Cache market data** for 2-3 seconds
4. **Priority scanning** (sx.bet only during live events)

## Performance Impact

### Vercel Function Execution

**Normal Mode**:
- 120 scans/hour × 0.3s = 36 seconds/hour
- Cost: Negligible on free tier

**Live Event Mode** (4 hour game):
- 720 scans/hour × 4 hours = 2,880 scans
- 2,880 × 0.3s = 864 seconds = 14.4 minutes
- Cost: Still within free tier

**Monthly Estimate**:
- Assume 2 live events per day, 3 hours each
- 2 × 3 × 720 × 30 = 129,600 scans/month
- 129,600 × 0.3s = 38,880 seconds = 10.8 hours
- ✅ Well within Vercel free tier (100 GB-hours)

## Configuration

### Adjust Intervals

In `lib/bot.ts`:

```typescript
this.scanner = new AdaptiveScanner({
  defaultInterval: 30000,      // 30 seconds
  liveEventInterval: 5000,     // 5 seconds (adjust if needed)
  highActivityInterval: 10000, // 10 seconds
  quietInterval: 60000,        // 60 seconds
});
```

### Ultra-Aggressive Mode (Not Recommended)

```typescript
this.scanner = new AdaptiveScanner({
  liveEventInterval: 2000,     // 2 seconds (VERY aggressive)
  highActivityInterval: 5000,  // 5 seconds
  defaultInterval: 15000,      // 15 seconds
});
```

⚠️ **Warning**: May hit rate limits quickly!

### Conservative Mode

```typescript
this.scanner = new AdaptiveScanner({
  liveEventInterval: 10000,    // 10 seconds (slower live)
  highActivityInterval: 20000, // 20 seconds
  defaultInterval: 45000,      // 45 seconds
});
```

## Real-World Scenarios

### Scenario 1: Prime Time NBA Game

```
7:00pm: Lakers tip-off
├─ Bot detects live event
├─ Switches to 5-second scanning
├─ Scans 720 times per hour
├─ Finds 3 arbitrage opportunities
│   ├─ 7:05pm: Spread arbitrage (executed)
│   ├─ 8:12pm: Moneyline arbitrage (executed)
│   └─ 9:45pm: Total arbitrage (executed)
└─ 10:30pm: Game ends, switches to 30-second scanning
```

**Result**: Caught 3 opportunities that would have been missed with 30s scanning.

### Scenario 2: Quiet Tuesday Morning

```
10:00am: No live events, few markets
├─ Scans every 30 seconds
├─ 120 scans per hour
├─ Minimal API usage
├─ No opportunities found
└─ Conserves resources for evening rush
```

### Scenario 3: Live Event Bonanza

```
Sunday afternoon: Multiple NFL games live
├─ 3 live games detected
├─ 5-second scanning activated
├─ High volume of odds changes
├─ Found 8 arbitrage opportunities
│   └─ Executed top 5 (per-scan limit)
└─ Total profit: $47 in 4 hours
```

**Key**: Without fast scanning, would have missed 6-7 of these opportunities.

## Monitoring

### Dashboard Metrics

Add to dashboard to monitor:
- Current scan interval
- Live events detected
- Scans per hour
- API calls per platform
- Rate limit warnings

### Logs

```
[2:15pm] 📊 Normal mode - Scanning every 30 seconds
[7:00pm] 🔴 LIVE EVENTS (2) - Scanning every 5 seconds
[7:05pm] ✅ Arbitrage found (Lakers spread: 2.3%)
[10:00pm] 📊 Normal mode - Scanning every 30 seconds
[1:00am] 😴 Quiet mode - Scanning every 60 seconds
```

## Best Practices

1. **Start Conservative**: Use default settings initially
2. **Monitor API Usage**: Watch for rate limit errors
3. **Adjust Based on Results**: If missing opportunities, scan faster
4. **Time-Based Rules**: Different intervals for different times
5. **Platform-Specific**: Scan sx.bet faster during events, others normal

## Future Enhancements

### Phase 2: Event-Aware Scanning

- Subscribe to game start notifications
- Pre-scan before known events (game about to start)
- Platform-specific intervals (sx.bet 5s, others 30s during live games)

### Phase 3: ML-Based Adaptation

- Learn which times have most opportunities
- Predict high-activity periods
- Auto-adjust based on historical patterns

### Phase 4: WebSocket Integration

- Real-time odds updates (no polling needed)
- Instant arbitrage detection
- Zero latency during live events

## Summary

### Current System

| Mode | Interval | When | Scans/Hour |
|------|----------|------|------------|
| 🔴 **Live** | 5s | Market-detected live events | 720 |
| ⚡ **High** | 10s | Recent opportunities found | 360 |
| 📊 **Normal** | 30s | Default (no live events) | 120 |

### Key Benefits

✅ **Fast during live events** (5s = catch rapid opportunities)  
✅ **Market-driven detection** (no time-of-day assumptions)  
✅ **Global 24/7 awareness** (European soccer, Asian tennis, etc.)  
✅ **Adaptive** (responds to actual market conditions)  
✅ **Within rate limits** (safe API usage)  
✅ **Cost effective** (free tier sufficient)

**Bottom Line**: Your bot scans **5 seconds during any live event globally** to maximize arbitrage detection! 🚀🌍

---

**Last Updated**: January 2025  
**Status**: Implemented and ready for live event arbitrage

