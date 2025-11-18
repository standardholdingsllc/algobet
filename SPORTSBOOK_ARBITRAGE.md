# Sportsbook vs Prediction Market Arbitrage

## Critical Difference in Market Types

### Prediction Markets (Kalshi, Polymarket)
**Binary outcomes paying $1.00**:
```
Buy 100 shares at 45¢ each = $45 investment
If you win: Get $100 (100 shares × $1.00)
If you lose: Get $0
```

### Sportsbooks (sx.bet)
**Decimal odds multiplier**:
```
Stake $100 at 1.78 odds
If you win: Get $178 ($100 stake × 1.78 odds)
If you lose: Get $0
```

**This is fundamentally different math!**

## Arbitrage Calculation Examples

### Example 1: Prediction Market vs Sportsbook

**Scenario**: Lakers vs Celtics

**Polymarket** (prediction market):
- Lakers YES at 40¢ ($0.40 per share)
- Each share pays $1.00 if Lakers win

**sx.bet** (sportsbook):
- Celtics at 2.10 decimal odds
- Payout = stake × 2.10

**Arbitrage Calculation**:

1. **Set target payout**: $100 (standardized amount)

2. **Polymarket side**:
   - Need 100 shares to get $100 payout
   - Cost: 100 × $0.40 = $40

3. **sx.bet side**:
   - Want $100 payout
   - Stake = $100 ÷ 2.10 = $47.62

4. **Total investment**: $40 + $47.62 = **$87.62**
5. **Guaranteed return**: **$100** (either side wins)
6. **Profit**: $12.38
7. **ROI**: 14.1% ✅

### Example 2: With Fees

**Polymarket** (2% fee):
- Lakers YES at 45¢
- 100 shares = $45
- Fee = $0.90
- **Total: $45.90**

**sx.bet** (0% fee):
- Celtics at 2.00 odds
- Need $100 payout
- Stake = $100 ÷ 2.00 = $50
- Fee = $0
- **Total: $50.00**

**Analysis**:
- Total cost: $95.90
- Guaranteed return: $100
- Profit: $4.10 (4.3% ROI) ✅

### Example 3: Two Sportsbooks

**sx.bet Lakers**: 1.80 odds  
**Another sportsbook Celtics**: 2.20 odds

1. **Target payout**: $100
2. **sx.bet stake**: $100 ÷ 1.80 = $55.56
3. **Other book stake**: $100 ÷ 2.20 = $45.45
4. **Total**: $101.01
5. **Return**: $100
6. **Loss**: -$1.01 ❌ **NOT ARBITRAGE**

This shows the "vig" (bookie's edge) - both sides sum to more than 100%.

## Mathematical Formulas

### Converting Odds Formats

**Decimal odds → Implied probability**:
```
Implied Prob = 1 / Decimal Odds
Example: 1.78 odds → 1/1.78 = 56.18%
```

**Implied probability → Decimal odds**:
```
Decimal Odds = 1 / Implied Prob
Example: 40% → 1/0.40 = 2.50 odds
```

**Prediction market price → Decimal odds equivalent**:
```
Price in cents = 40¢ = 0.40 probability
Equivalent decimal odds = 1/0.40 = 2.50
```

### Arbitrage Check

For prediction market (PM) vs sportsbook (SB):

```
Cost_PM = (Price_PM / 100) × Shares
Payout_PM = Shares (if win)

Cost_SB = Payout_target / Odds_SB
Payout_SB = Payout_target

Total_Cost = Cost_PM + Cost_SB
Guaranteed_Return = Payout_target

Profit_Margin = ((Guaranteed_Return - Total_Cost) / Total_Cost) × 100%

Arbitrage exists if: Total_Cost < Guaranteed_Return
```

### Bet Sizing

To equalize payouts:

**Prediction market side**:
```
Shares = Payout_target
Cost = (Price / 100) × Shares
```

**Sportsbook side**:
```
Stake = Payout_target / Odds
Cost = Stake (plus fees if any)
```

**Total cost with fees**:
```
Total = Cost_PM × (1 + Fee_PM%) + Cost_SB × (1 + Fee_SB%)
```

## Real-World Example Calculation

### Scenario
- **Kalshi**: Lakers YES at 42¢ (7% fee)
- **sx.bet**: Celtics at 1.90 odds (0% fee)

### Step-by-Step

1. **Set target**: $100 payout

2. **Kalshi (prediction)**:
   - Shares needed: 100
   - Base cost: 100 × $0.42 = $42.00
   - Fee: $42 × 0.07 × 0.42 × 0.58 = $0.71
   - **Total: $42.71**

3. **sx.bet (sportsbook)**:
   - Stake: $100 ÷ 1.90 = $52.63
   - Fee: $0
   - **Total: $52.63**

4. **Results**:
   - Total investment: $95.34
   - Guaranteed return: $100.00
   - **Profit: $4.66 (4.9% ROI)** ✅

## Why sx.bet is Great for Arbitrage

1. **0% Fees** → No fee erosion on one side
2. **Decimal odds are often mis-priced** relative to prediction markets
3. **Sports betting has high liquidity**
4. **Different user bases** create pricing inefficiencies

## Common Pitfalls

### ❌ Treating Sportsbook Like Prediction Market

**Wrong**:
```javascript
// Treating 1.78 odds as "78¢ price"
cost = 0.78 × 100 = $78
```

**Correct**:
```javascript
// Calculating stake for target payout
stake = 100 / 1.78 = $56.18
```

### ❌ Not Equalizing Payouts

**Wrong**:
```
Buy 100 shares on Polymarket
Stake $100 on sx.bet at 2.00 odds
```

This doesn't hedge properly because:
- Polymarket pays $100
- sx.bet pays $200
- Different payouts = not hedged!

**Correct**:
```
Buy 100 shares on Polymarket → $100 payout
Stake $50 on sx.bet at 2.00 odds → $100 payout
Both sides pay $100 → properly hedged ✅
```

### ❌ Ignoring the Vig

Sportsbooks build in edge:
```
Lakers: 1.90 odds (52.6% implied)
Celtics: 1.95 odds (51.3% implied)
Total: 103.9% (the 3.9% is the vig)
```

You can only arbitrage against OTHER platforms, not the same sportsbook's opposite sides.

## Implementation in AlgoBet

The bot now:

1. **Detects market type** (`prediction` vs `sportsbook`)
2. **Uses appropriate calculations**:
   - Prediction: $1 payout per share
   - Sportsbook: Stake × odds payout
3. **Sizes bets correctly** to equalize payouts
4. **Accounts for different fee structures**

## Key Changes Made

1. ✅ Added `marketType` field to Market interface
2. ✅ sx.bet now stores decimal odds (not cents)
3. ✅ Created `arbitrage-sportsbook.ts` for mixed market calculations
4. ✅ Updated `calculateArbitrage()` to detect and handle mixed markets
5. ✅ Proper bet sizing for equalized payouts

## Testing Example

```typescript
// Prediction market
const polymarket = {
  platform: 'polymarket',
  marketType: 'prediction',
  yesPrice: 40, // 40¢
  noPrice: 60,
  fee: 2.0
};

// Sportsbook
const sxbet = {
  platform: 'sxbet',
  marketType: 'sportsbook',
  yesPrice: 2.10, // 2.10 decimal odds
  noPrice: 1.85,
  fee: 0
};

// Calculate arbitrage
const arb = calculateMixedMarketArbitrage(
  polymarket, 
  sxbet, 
  'yes', // Polymarket YES
  'no'   // sx.bet NO (other outcome)
);

// Result:
// Polymarket: $40 for 100 shares
// sx.bet: $54.05 stake at 1.85 odds
// Total: $94.05
// Return: $100
// Profit: $5.95 (6.3% ROI) ✅
```

## Resources

- [sx.bet API Docs](https://api.docs.sx.bet/)
- [Decimal Odds Explained](https://en.wikipedia.org/wiki/Odds#Decimal_odds)
- [Arbitrage Calculator](https://www.sportsbookreview.com/betting-calculators/arbitrage-calculator/)

---

**Last Updated**: January 2025  
**Critical**: Always equalize payouts when arbitraging mixed market types!

