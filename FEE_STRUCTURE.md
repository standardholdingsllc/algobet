# Fee Structure Documentation

Understanding and accurately calculating fees is **critical** for profitable arbitrage trading. This document details the exact fee structures for each platform.

## Kalshi Fees

Source: [Kalshi Fee Schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf)

### General Markets

**Formula**: `fees = round_up(0.07 × C × P × (1-P))`

Where:
- `C` = Number of contracts
- `P` = Price in dollars (0-1, so 50¢ = 0.5)
- `round_up` = Round up to next cent

**Effective rate**: ~7% of expected value

**Examples** (100 contracts):

| Price | Fee | As % of Investment |
|-------|-----|-------------------|
| 10¢ | $0.63 | 6.3% |
| 25¢ | $1.32 | 5.3% |
| 50¢ | $1.75 | 3.5% |
| 75¢ | $1.32 | 1.8% |
| 90¢ | $0.63 | 0.7% |

**Key Insight**: Fees are highest at 50/50 odds and decrease as prices move toward extremes.

### S&P500 and NASDAQ-100 Markets

**Applies to**: Tickers starting with `INX` or `NASDAQ100`

**Formula**: `fees = round_up(0.035 × C × P × (1-P))`

**Effective rate**: ~3.5% of expected value (half of general markets)

**Examples** (100 contracts):

| Price | Fee | Savings vs General |
|-------|-----|-------------------|
| 25¢ | $0.66 | $0.66 (50%) |
| 50¢ | $0.88 | $0.87 (50%) |
| 75¢ | $0.66 | $0.66 (50%) |

### Maker Fees (Resting Orders)

**Formula**: `fees = round_up(0.0175 × C × P × (1-P))`

**Effective rate**: ~1.75% of expected value

**When charged**: Only when your limit order sits on the orderbook and gets filled later (not immediate execution)

**Examples** (100 contracts at 50¢):
- General market maker fee: $0.44 (vs $1.75 taker)
- S&P500 maker fee: $0.22 (vs $0.88 taker)

**Note**: Our bot uses Fill-or-Kill orders (immediate execution), so we typically pay taker fees.

### Other Kalshi Fees

- ✅ **No settlement fee**
- ✅ **No membership fee**
- ✅ **No ACH deposit/withdrawal fees**
- ❌ **2% debit card deposit fee**
- ❌ **$2 debit card withdrawal fee**

## Polymarket Fees

Source: [Polymarket Documentation](https://docs.polymarket.com/)

### Trading Fees

**Taker Fee**: ~2% of notional value
- Charged when you take liquidity from the orderbook
- Varies slightly by market maker

**Maker Fee**: 0%
- No fee for providing liquidity
- Orders that rest on the book

### Gas Fees

**Network**: Polygon (USDC)
- Gas fees: ~$0.01-0.05 per transaction
- Much cheaper than Ethereum mainnet
- Included in our fee calculations

### Total Cost Formula

For a taker order:
```
fee = (price × quantity × 0.02) + gas_fee
```

Where:
- `price` = Price in dollars (0-1)
- `quantity` = Number of contracts
- `gas_fee` ≈ $0.02 (conservative estimate)

**Example** (100 contracts at 28¢):
- Base cost: $28.00
- Trading fee: $0.56 (2%)
- Gas fee: $0.02
- **Total fee: $0.58**
- **Total cost: $28.58**

## Fee Comparison

At 50/50 odds (50¢ price) for 100 contracts:

| Platform | Base Cost | Fee | Total Cost | Fee % |
|----------|-----------|-----|------------|-------|
| Kalshi (General) | $50.00 | $1.75 | $51.75 | 3.5% |
| Kalshi (S&P500) | $50.00 | $0.88 | $50.88 | 1.8% |
| Polymarket | $50.00 | $1.02 | $51.02 | 2.0% |

## Impact on Arbitrage

### Example 1: No Arbitrage Due to Fees

**Before fees**:
- Kalshi: 72¢ → $72.00 for 100 contracts
- Polymarket: 27¢ → $27.00 for 100 contracts
- Total: $99.00 (looks profitable!)

**After fees**:
- Kalshi: $72.00 + $1.41 = $73.41
- Polymarket: $27.00 + $0.56 = $27.56
- **Total: $100.97** ❌ NOT PROFITABLE

### Example 2: Real Arbitrage

**Before fees**:
- Kalshi: 68¢ → $68.00
- Polymarket: 30¢ → $30.00
- Total: $98.00

**After fees**:
- Kalshi: $68.00 + $1.52 = $69.52
- Polymarket: $30.00 + $0.62 = $30.62
- **Total: $100.14** ❌ STILL NOT PROFITABLE

**Need**: Combined prices + fees < $100 for 100 contracts

### Example 3: Profitable After Fees

**Before fees**:
- Kalshi: 65¢ → $65.00
- Polymarket: 32¢ → $32.00
- Total: $97.00

**After fees**:
- Kalshi: $65.00 + $1.60 = $66.60
- Polymarket: $32.00 + $0.66 = $32.66
- **Total: $99.26** ✅ PROFITABLE
- **Profit: $0.74 per 100 contracts (0.74%)**

## Implementation in AlgoBet

### Accurate Fee Calculation

```typescript
// Kalshi
const kalshiFee = 0.07 × contracts × price × (1 - price);
const roundedFee = Math.ceil(kalshiFee * 100) / 100;

// S&P500/NASDAQ
const indexFee = 0.035 × contracts × price × (1 - price);
const roundedFee = Math.ceil(indexFee * 100) / 100;

// Polymarket
const polymktFee = (price × contracts × 0.02) + 0.02; // +gas
```

### Arbitrage Validation

```typescript
const cost1 = baseCost1 + calculateFee(platform1, ticker1, price1, qty);
const cost2 = baseCost2 + calculateFee(platform2, ticker2, price2, qty);
const totalCost = cost1 + cost2;
const profitMargin = ((1.0 - totalCost) / totalCost) × 100;

if (profitMargin >= minProfitMargin && totalCost < 1.0) {
  // Execute arbitrage
}
```

### Why This Matters

Without accurate fee calculations:
- ❌ Bot executes "fake" arbitrage that loses money
- ❌ Guaranteed losses instead of guaranteed profits
- ❌ Fees can turn 1% profit into 1% loss
- ❌ Higher costs mean fewer opportunities

With accurate fee calculations:
- ✅ Only execute truly profitable arbitrage
- ✅ Know exact profit before execution
- ✅ Account for market-specific fees (S&P500 discount)
- ✅ Realistic profit expectations

## Testing Fees

Run the fee calculation tests:

```bash
npm run test-fees
```

This validates our calculations against Kalshi's published fee schedule.

## Key Takeaways

1. **Fees vary by platform and market type**
   - Kalshi: 7% (general) or 3.5% (index markets)
   - Polymarket: ~2% + gas

2. **Fees are non-linear**
   - Highest at 50/50 odds
   - Lower at extreme prices (10¢ or 90¢)

3. **Small differences matter**
   - 1¢ price difference = ~$1 on 100 contracts
   - Fees can be $1-2 per 100 contracts
   - Need >2-3% gross margin for profitable arbitrage

4. **Always calculate before execution**
   - Never assume fees are negligible
   - Check actual cost including fees
   - Validate opportunity still exists after fees

5. **Market-specific fees exist**
   - S&P500 and NASDAQ-100 have half the fees
   - Look for arbitrage on these markets first
   - Higher profit margins possible

## Resources

- [Kalshi Fee Schedule (PDF)](https://kalshi.com/docs/kalshi-fee-schedule.pdf)
- [Polymarket Documentation](https://docs.polymarket.com/)
- [Fee Calculation Code](lib/fees.ts)
- [Test Suite](scripts/test-fee-calculations.js)

---

**Last Updated**: January 2025  
**Version**: 1.0.0  
**Always verify current fees on official platform documentation**

