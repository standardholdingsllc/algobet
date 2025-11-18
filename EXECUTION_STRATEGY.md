# Execution Strategy: Scan Everything, Execute Selectively

## Overview

AlgoBet uses a **smart two-phase approach** to maximize opportunity discovery while avoiding long capital lockups:

1. **Phase 1: Wide Scanning** - Scan ALL markets (up to 30 days out)
2. **Phase 2: Selective Execution** - Only execute bets on markets expiring within 10 days

## The Problem We're Solving

### Without This Strategy ❌

**Scanning only 5-day markets:**
```
Missed Opportunities:
- Election market has 3% arb (expires in 60 days) → NEVER SEEN
- NFL Playoffs market (expires in 14 days) → NEVER SEEN
- Bitcoin price market (expires in 10 days) → NEVER SEEN

Result: Limited opportunity discovery
```

**Executing on all markets:**
```
Found 2.5% arb on Presidential Election (expires in 120 days)
→ Bet $1,000 on each side
→ Capital locked for 4 months
→ Only $25 profit after 4 months = 0.5% monthly return
→ Miss 50+ better short-term opportunities

Result: Capital inefficiently deployed
```

### With This Strategy ✅

**Scan everything, execute selectively:**
```
SCAN PHASE:
├─ Yankees game (2 hours) → 2.3% arb → ✅ TRACK + EXECUTE
├─ Lakers game (1 day) → 1.8% arb → ✅ TRACK + EXECUTE  
├─ Super Bowl (12 days) → 3.2% arb → 🔍 TRACK (wait for 10-day window)
└─ Election (90 days) → 2.8% arb → 🔍 TRACK (log opportunity)

EXECUTION PHASE:
├─ Yankees game: ✅ BET PLACED ($800/side)
├─ Lakers game: ✅ BET PLACED ($800/side)
├─ Super Bowl: ⏸️  Skipping - expires in 12 days (max: 10 days)
└─ Election: ⏸️  Skipping - expires in 90 days (max: 10 days)

Result: Capital deployed efficiently on near-term opportunities
```

## How It Works

### 1. Market Fetching (Wide Net)

```typescript
// In lib/bot.ts
const [kalshiMarkets, polymarketMarkets, sxbetMarkets] = await Promise.all([
  this.kalshi.getOpenMarkets(30), // Fetch up to 30 days out
  this.polymarket.getOpenMarkets(30),
  this.sxbet.getOpenMarkets(30),
]);
```

**Why 30 days?**
- Captures most actively traded markets
- Sees opportunities on upcoming events (NFL playoffs, major political events)
- Not so long that we're fetching irrelevant markets (elections 2 years away)
- Balances API load vs opportunity discovery

### 2. Opportunity Detection (All Markets)

```typescript
// Check all tracked markets (regardless of expiry)
for (const trackedMarket of trackedMarkets) {
  const combinations = this.hotMarketTracker.getAllCombinations(trackedMarket);
  
  for (const [market1, market2] of combinations) {
    const opps = findArbitrageOpportunities([market1], [market2], config.minProfitMargin);
    
    if (opps.length > 0) {
      console.log(
        `🔥 Found ${opps.length} arb(s) for tracked market: ${trackedMarket.displayTitle} ` +
        `(${market1.platform} vs ${market2.platform})`
      );
      // Opportunities logged regardless of expiry
    }
  }
}
```

### 3. Execution Filter (5-Day Window)

```typescript
// In executeBet()
const now = new Date();
const maxExpiryDate = new Date(now.getTime() + config.maxDaysToExpiry * 24 * 60 * 60 * 1000);

const market1Expiry = new Date(opportunity.market1.expiryDate);
const market2Expiry = new Date(opportunity.market2.expiryDate);

if (market1Expiry > maxExpiryDate || market2Expiry > maxExpiryDate) {
  const daysToExpiry = Math.max(daysToExpiry1, daysToExpiry2);
  
  console.log(
    `⏸️  Skipping bet - market expires in ${daysToExpiry.toFixed(1)} days ` +
    `(max: ${config.maxDaysToExpiry} days). ` +
    `Opportunity: ${opportunity.profitMargin.toFixed(2)}% profit`
  );
  return; // Don't execute, but opportunity was logged
}

// If we get here, market expires within 10 days → EXECUTE
```

## Real-World Example

### Sunday During NFL Season

```
[1:00pm] Scanning 847 markets across platforms...

LIVE EVENTS (Execute immediately):
├─ 🏈 Bills vs Chiefs (expires 4:30pm today) → 2.1% arb → ✅ EXECUTED
├─ 🏈 Cowboys vs Eagles (expires 7:30pm today) → 1.9% arb → ✅ EXECUTED
└─ 🏀 Lakers vs Celtics (expires 10pm today) → 2.3% arb → ✅ EXECUTED

NEAR-TERM EVENTS (Within 10 days - Execute):
├─ 🏈 Monday Night Football (expires tomorrow) → 1.7% arb → ✅ EXECUTED
├─ 📊 Fed announcement (expires in 3 days) → 2.2% arb → ✅ EXECUTED
├─ 🏀 NBA All-Star voting (expires in 4 days) → 1.5% arb → ✅ EXECUTED
└─ 🏈 Thursday Night Football (expires in 8 days) → 2.0% arb → ✅ EXECUTED

MID-TERM EVENTS (10-30 days - Track only):
├─ 🏈 Super Bowl (expires in 14 days) → 3.2% arb → ⏸️  TRACKED
│  └─ Will auto-execute when it enters 10-day window
├─ 📊 Quarterly Earnings (expires in 18 days) → 2.1% arb → ⏸️  TRACKED
└─ 🏀 NBA Playoffs start (expires in 21 days) → 2.8% arb → ⏸️  TRACKED

RESULTS:
✅ Executed 7 bets (all expire within 10 days)
🔍 Tracking 3 opportunities (will execute when they enter window)
💰 Capital deployed efficiently on near-term opportunities
```

### The Following Sunday (1 Week Later)

```
[1:00pm] Scanning markets...

TRACKED MARKET UPDATE:
🏈 Super Bowl market (was 14 days, now 7 days away)
   → NOW WITHIN 10-DAY WINDOW → ✅ EXECUTING BETS
   → Arb still exists: 3.2% profit
   
Result: Captured the 3.2% arb at the perfect time!
```

## Benefits

### 1. Opportunity Discovery 📊

**See the full landscape:**
```
Found 42 arbitrage opportunities today:
├─ 18 live events (expire today)
├─ 12 near-term (2-5 days)
├─ 8 mid-term (6-15 days)
└─ 4 long-term (16-30 days)

Dashboard shows:
"You have 42 opportunities available, executing on 30 within your 5-day window"
```

### 2. Capital Efficiency 💵

**No long lockups:**
```
WITH 5-day filter:
$10,000 capital → Turnover every 2-3 days
→ ~10 trades per month
→ Average 2% profit per trade
→ 20% monthly return

WITHOUT 5-day filter:
$10,000 capital → Some locked for 30+ days
→ ~4 trades per month (capital tied up)
→ Average 2% profit per trade  
→ 8% monthly return

Result: 2.5x more profitable with smart filtering!
```

### 3. Flexibility ⚙️

**Adjustable in config:**
```typescript
// config.maxDaysToExpiry = 10 (default, balanced)
// Executes on: Live events and everything up to 10 days out
// Capital turnover: Good balance (4-5 days average)

// config.maxDaysToExpiry = 15 (aggressive)
// Executes on: Everything up to 15 days out
// Capital turnover: Slower but more opportunities

// config.maxDaysToExpiry = 5 (conservative)
// Executes on: Live events, this week's events
// Capital turnover: Faster (2-3 days average)

// config.maxDaysToExpiry = 1 (ultra-conservative)
// Executes on: Only tomorrow's events and live
// Capital turnover: Very fast (1 day average)
```

### 4. Market Intelligence 🧠

**Learn from long-dated markets:**
```
Tracking Election 2024 market (90 days out):
├─ Day 1: 2.8% arb (Kalshi 52¢, Polymarket 46¢)
├─ Day 15: 3.1% arb (Kalshi 54¢, Polymarket 45¢)
├─ Day 30: 2.2% arb (Kalshi 51¢, Polymarket 47¢)
└─ Day 45: 1.8% arb (odds converging)

Insights:
→ Large persistent arbs indicate platform user base differences
→ Can plan strategy for when market enters 5-day window
→ Might increase minProfitMargin for this specific market type
```

## Console Output

### What You'll See

```bash
[2:15pm] Scanning for arbitrage opportunities...

Found 847 markets total
🎯 Tracking 34 markets across platforms (15 live, 87 platform combinations)

OPPORTUNITIES FOUND:
🔥 Found 1 arb for tracked market: Yankees vs Red Sox (kalshi vs sxbet) - 2.3% profit
🔥 Found 2 arbs for tracked market: Lakers vs Celtics (polymarket vs sxbet) - 1.8% profit

Found 18 total arbitrage opportunities (12 from tracked markets, 6 from general scan)

EXECUTING BEST OPPORTUNITIES:
1. ✅ Executing: Yankees vs Red Sox (2.3% profit, expires in 2 hours)
2. ✅ Executing: Lakers vs Celtics (1.8% profit, expires in 5 hours)
3. ⏸️  Skipping bet - market expires in 18.3 days (max: 10 days). Opportunity: 3.2% profit
4. ✅ Executing: NFL game (2.1% profit, expires in 8 days)
5. ✅ Executing: Fed announcement (2.2% profit, expires in 3 days)

RESULTS:
✅ Executed 4 bets (all within 10-day window)
⏸️  Skipped 1 opportunity (too far out, but tracked)
```

## Configuration

### In Dashboard

The `maxDaysToExpiry` setting controls execution filtering:

```
Bot Configuration:
├─ Max Bet Percentage: 4%
├─ Max Days to Expiry: [10] days ← Controls execution filter
│  └─ Info: "Scans all markets, only executes on near-term"
├─ Min Profit Margin: 1.5%
└─ Balance Thresholds: ...
```

### In Code

```typescript
// types/index.ts
export interface BotConfig {
  maxBetPercentage: number;
  maxDaysToExpiry: number;   // Execution filter (default: 10)
  minProfitMargin: number;
  // ...
}

// lib/storage.ts
const DEFAULT_CONFIG: BotConfig = {
  maxBetPercentage: 4,
  maxDaysToExpiry: 10,         // Only execute on markets ≤ 10 days
  minProfitMargin: 1,
  // ...
};
```

## Best Practices

### Recommended Settings by Risk Profile

**Conservative (Fast Capital Turnover):**
```typescript
{
  maxDaysToExpiry: 3,          // Only next 3 days
  maxBetPercentage: 3,         // Smaller positions
  minProfitMargin: 2           // Higher profit threshold
}
// Result: Very fast capital recycling, miss some opportunities
```

**Balanced (Default):**
```typescript
{
  maxDaysToExpiry: 10,         // 10-day window
  maxBetPercentage: 4,         // Full positions
  minProfitMargin: 1           // Standard threshold
}
// Result: Good balance of opportunity capture and capital efficiency
```

**Aggressive (More Opportunities):**
```typescript
{
  maxDaysToExpiry: 20,         // 20-day window
  maxBetPercentage: 4,         // Full positions
  minProfitMargin: 0.8         // Lower threshold
}
// Result: More bets, slower capital turnover, more capital required
```

## Future Enhancements

### Dynamic Window Adjustment

```typescript
// Adjust window based on opportunity quality
if (profitMargin > 3.0 && daysToExpiry <= 15) {
  // Exceptional opportunity, extend window
  execute = true;
}

if (profitMargin < 1.5 && daysToExpiry > 2) {
  // Marginal opportunity, tighten window
  execute = false;
}
```

### Market-Specific Windows

```typescript
// Different windows for different market types
const windows = {
  sports: 3,        // Fast-moving, execute sooner
  politics: 7,      // Slower-moving, longer window OK
  crypto: 5,        // Medium volatility
  economics: 10     // Very slow-moving
};
```

### Opportunity Cost Analysis

```typescript
// Don't execute if better opportunities are available
if (currentOpportunity.profit < 2% && 
    availableOpportunities.some(o => o.profit > 3% && o.daysToExpiry <= 2)) {
  skip = true; // Save capital for better near-term opportunities
}
```

## Summary

### The Strategy

📊 **Scan wide** (30 days) → 🔍 **Track everything** → ✅ **Execute selectively** (10 days)

### Key Points

1. **Scans**: ALL markets up to 30 days
2. **Tracks**: Markets on 2+ platforms (regardless of expiry)
3. **Logs**: All arbitrage opportunities found
4. **Executes**: Only on markets expiring ≤ 10 days (configurable)
5. **Benefit**: Full opportunity visibility + efficient capital deployment

### Result

**You see everything, but only act on the best timing for capital efficiency.** 🎯

---

**Status**: Implemented and active  
**Configuration**: Adjustable via dashboard or `BotConfig`  
**Default**: 10-day execution window  
**Last Updated**: January 2025

