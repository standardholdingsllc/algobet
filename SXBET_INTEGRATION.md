# SX.bet Integration Guide

## Overview

SX.bet is a decentralized sports betting exchange on its own L2 blockchain. Adding it to AlgoBet opens up arbitrage opportunities between sports betting and prediction markets.

**Documentation**: [https://api.docs.sx.bet/](https://api.docs.sx.bet/)

## Key Differences from Kalshi/Polymarket

### 1. **Sports Betting Focus**
- Primarily sports markets (NFL, NBA, MLB, etc.)
- Can arbitrage sports bets vs prediction markets
- Example: sx.bet Lakers moneyline vs Polymarket "Lakers win" market

### 2. **Own L2 Blockchain (SX Network)**
- Chain ID: 4162 (mainnet)
- USDC address: `0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B`
- RPC: `https://rpc.sx-rollup.gelato.digital`
- **Important**: This is DIFFERENT from Ethereum/Polygon USDC

### 3. **Unique Odds Format**
```typescript
// sx.bet uses percentage odds / 10^20
percentageOdds = "70455284072443640000"
impliedProb = 70455284072443640000 / 10^20 = 0.704552841 (70.46%)

// These are MAKER odds, so taker gets:
takerProb = 1 - 0.704552841 = 0.295447159 (29.54%)

// Convert to our standard format (cents):
price = 29.54¢
```

### 4. **Zero Fees** 🎉
- **Maker fee**: 0%
- **Taker fee**: 0%
- **Best for arbitrage** because no fees eat into profits!

### 5. **Order Book Model**
- Like a traditional exchange
- Users post limit orders
- Orders can be filled by anyone
- Better liquidity on popular sports

## Setup Requirements

### 1. Get API Key

Contact sx.bet team on Discord: [https://discord.gg/sxbet](https://discord.gg/sxbet)

Add to `.env`:
```env
SXBET_API_KEY=your-api-key-here
SXBET_WALLET_ADDRESS=your-wallet-address-on-sx-network
SXBET_PRIVATE_KEY=your-private-key-for-signing
```

### 2. Fund SX Network Wallet

**Important**: You need USDC on the SX Network (NOT Ethereum mainnet)

#### Bridge USDC to SX Network:
1. Visit: [https://sx.bet](https://sx.bet)
2. Connect wallet
3. Use built-in bridge to transfer USDC from Ethereum/Polygon
4. Minimum: $100-200 recommended to start

#### Add SX Network to MetaMask:
```json
{
  "chainName": "SX Network",
  "chainId": 4162,
  "nativeCurrency": {
    "name": "SX",
    "symbol": "SX",
    "decimals": 18
  },
  "rpcUrls": ["https://rpc.sx-rollup.gelato.digital"],
  "blockExplorerUrls": ["https://explorerl2.sx.technology"]
}
```

## Current Implementation Status

### ✅ Implemented
- Market data fetching
- Odds conversion (percentage odds → cents)
- Market title generation (sport, league, teams)
- Balance checking structure
- Order book queries
- Zero fee integration

### ⚠️ Partial Implementation
- **Balance checking**: Requires Web3 integration to query SX Network
- **Bet placement**: Requires EIP712 signing implementation

### 🚧 TODO: Complete Trading Integration

The current implementation fetches market data but **cannot place bets yet**. Here's what needs to be added:

#### 1. EIP712 Signing for Orders

sx.bet requires EIP712 signatures for bet placement:

```typescript
// Example from their docs
import { signTypedData, SignTypedDataVersion } from "@metamask/eth-sig-util";

const payload = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" }
    ],
    FillOrder: [
      { name: "orderHash", type: "bytes32" },
      { name: "fillAmount", type: "uint256" },
      // ... more fields
    ]
  },
  domain: {
    name: "SX.bet",
    version: "1.0",
    chainId: 4162
  },
  message: {
    // Order details
  }
};

const signature = signTypedData({
  privateKey: bufferPrivateKey,
  data: payload,
  version: SignTypedDataVersion.V4,
});
```

#### 2. Web3 Integration for Balance

Query USDC balance on SX Network:

```typescript
import { ethers } from 'ethers';

const provider = new ethers.providers.JsonRpcProvider(
  'https://rpc.sx-rollup.gelato.digital'
);

const usdcAddress = '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B';
const usdcABI = ['function balanceOf(address) view returns (uint256)'];
const usdcContract = new ethers.Contract(usdcAddress, usdcABI, provider);

const balance = await usdcContract.balanceOf(walletAddress);
const balanceUSD = Number(balance) / 1e6; // USDC has 6 decimals
```

#### 3. Fill Orders API

Implement the full fill flow:

```typescript
// 1. Get best orders
const orders = await getOrdersForMarket(marketHash, side);

// 2. Sign EIP712 message
const signature = await signFillOrder(orders, quantity);

// 3. Submit fill
const response = await axios.post('https://api.sx.bet/orders/fill', {
  orderHashes: orders.map(o => o.orderHash),
  takerAmounts: [...],
  taker: walletAddress,
  fillSalt: generateSalt(),
  signature,
});
```

## Market Types

sx.bet supports multiple bet types:

### 1. Moneyline (type: 1)
```
"Lakers vs Celtics - Winner"
Outcome One: Lakers win
Outcome Two: Celtics win
```

### 2. Spread (type: 2)
```
"Lakers vs Celtics - Spread -5.5"
Outcome One: Lakers win by >5.5
Outcome Two: Lakers lose or win by <5.5
```

### 3. Total (Over/Under) (type: 3)
```
"Lakers vs Celtics - Total 215.5"
Outcome One: Over 215.5 points
Outcome Two: Under 215.5 points
```

## Arbitrage Examples

### Example 1: Sports Betting Arb

**sx.bet** (0% fees):
- Lakers moneyline: 45¢ (outcome one)

**Polymarket** (2% fees):
- Lakers to win: 53¢

**Calculation**:
- sx.bet cost: $0.45 + $0 = $0.45
- Polymarket cost: $0.47 + $0.0094 = $0.4794
- **Total: $0.9294** ✅ 7.6% profit!

### Example 2: Prediction Market Match

**sx.bet**:
- "NFL MVP - Patrick Mahomes": 38¢

**Kalshi**:
- "Will Patrick Mahomes win MVP?": NO at 60¢

**If matched** (similarity >70%):
- sx.bet YES: $0.38 (no fee)
- Kalshi NO: $0.60 + $0.0148 = $0.6148
- **Total: $0.9948** ✅ 0.52% profit

### Example 3: Cross-Sport Arb

Bot can find arbitrage between:
- sx.bet NBA markets
- Polymarket political markets that reference sports
- Kalshi sports-adjacent markets

## Configuration

Update bot config for sx.bet:

```typescript
{
  balanceThresholds: {
    kalshi: 100,
    polymarket: 100,
    sxbet: 50  // Can be lower due to 0% fees
  }
}
```

## Market Matching Considerations

### Sports Markets Need Special Handling

Add entity mappings for teams:

```typescript
addEntityMapping(['lakers', 'la lakers', 'los angeles lakers'], 'los angeles lakers');
addEntityMapping(['celtics', 'boston celtics'], 'boston celtics');
addEntityMapping(['mahomes', 'patrick mahomes'], 'patrick mahomes');
```

### Match Sports to Prediction Markets

Bot can match:
- ✅ sx.bet "Lakers win" ↔ Polymarket "Lakers to win championship"
- ✅ sx.bet "MVP winner" ↔ Kalshi "NFL MVP market"
- ✅ sx.bet "Game total" ↔ Similar over/under markets

## Advantages of sx.bet

1. **Zero Fees** → Higher profit margins
2. **High Liquidity** on popular sports
3. **Fast Settlement** (L2 blockchain)
4. **Order Book Model** → Better price discovery
5. **More Market Types** (spread, totals, etc.)

## Limitations

1. **Primarily Sports** - Limited non-sports markets
2. **Requires Bridge** - Need to move USDC to SX Network
3. **EIP712 Complexity** - More complex integration than REST APIs
4. **Lower Overlap** with prediction markets (but when it matches, great arb!)

## Next Steps to Complete Integration

### Phase 1: Read-Only (Current)
- ✅ Fetch markets
- ✅ Convert odds
- ✅ Display in dashboard

### Phase 2: Balance Checking
1. Add `ethers` dependency
2. Implement Web3 provider for SX Network
3. Query USDC balance
4. Update balance display

### Phase 3: Trading (Final)
1. Implement EIP712 signing
2. Add order matching logic
3. Implement fill submission
4. Test with small amounts
5. Enable in production

## Testing

Add to test suite:

```bash
npm run test-sxbet  # Create new test
```

Test cases:
- ✅ Odds conversion (percentage → cents)
- ✅ Market title generation
- ✅ Team name normalization
- ✅ Order filtering by side
- ⚠️ Balance checking (requires testnet)
- ⚠️ Order placement (requires testnet)

## Resources

- **API Docs**: [https://api.docs.sx.bet/](https://api.docs.sx.bet/)
- **Discord**: [https://discord.gg/sxbet](https://discord.gg/sxbet)
- **Website**: [https://sx.bet](https://sx.bet)
- **Testnet**: [https://toronto.sx.bet](https://toronto.sx.bet)
- **Explorer**: [https://explorerl2.sx.technology](https://explorerl2.sx.technology)

## Environment Variables Summary

Add to `.env`:

```env
# SX.bet API
SXBET_API_KEY=your-api-key-from-discord
SXBET_WALLET_ADDRESS=your-wallet-on-sx-network
SXBET_PRIVATE_KEY=your-private-key-for-signing

# Optional: Use testnet first
SXBET_USE_TESTNET=true
```

---

**Status**: Market data integration complete, trading integration requires EIP712 implementation

**Last Updated**: January 2025

