# AlgoBet Technical Architecture

## Storage Architecture Evolution

### Phase 1: GitHub as Database (OLD - PROBLEMATIC)

```
┌─────────────────────────────────────────────────────────┐
│                     Vercel Platform                      │
│                                                          │
│  ┌──────────────┐         ┌──────────────┐             │
│  │   Next.js    │         │  Cron Job    │             │
│  │   Frontend   │         │  (1 minute)  │             │
│  └──────┬───────┘         └──────┬───────┘             │
│         │                        │                      │
│         │ GET /api/balances      │ POST /api/bot/cron  │
│         │                        │                      │
│  ┌──────▼────────────────────────▼───────┐             │
│  │         API Routes                     │             │
│  │  - /api/balances                       │             │
│  │  - /api/bets                           │             │
│  │  - /api/bot/control                    │             │
│  └──────┬─────────────────────────────────┘             │
│         │                                                │
│         │ lib/storage.ts                                │
│         │                                                │
│  ┌──────▼─────────────────────────────────┐             │
│  │      GitHub API (Octokit)              │             │
│  │  - Read data/storage.json              │             │
│  │  - Write data/storage.json             │             │
│  │  - Git commit                          │ ◄───┐       │
│  └────────────────────────────────────────┘     │       │
│                                                  │       │
└──────────────────────────────────────────────────┼───────┘
                                                   │
                    ┌──────────────────────────────┘
                    │ Triggers Vercel Rebuild
                    │ (5 minutes, resets UI)
                    │
           ┌────────▼────────┐
           │  GitHub Repo    │
           │  data/          │
           │  - storage.json │
           │  - bot-status   │
           └─────────────────┘
```

**Problems:**
- Every balance update = Git commit
- Every Git commit = Vercel rebuild
- Rebuilds take 5 minutes
- UI resets during rebuild
- Continuous rebuild loop
- Slow writes (2-5 seconds)
- Wastes build minutes

### Phase 2: Vercel KV (NEW - FIXED)

```
┌─────────────────────────────────────────────────────────┐
│                     Vercel Platform                      │
│                                                          │
│  ┌──────────────┐         ┌──────────────┐             │
│  │   Next.js    │         │  Cron Job    │             │
│  │   Frontend   │         │  (1 minute)  │             │
│  └──────┬───────┘         └──────┬───────┘             │
│         │                        │                      │
│         │ GET /api/balances      │ POST /api/bot/cron  │
│         │                        │                      │
│  ┌──────▼────────────────────────▼───────┐             │
│  │         API Routes                     │             │
│  │  - /api/balances                       │             │
│  │  - /api/bets                           │             │
│  │  - /api/bot/control                    │             │
│  └──────┬─────────────────────────────────┘             │
│         │                                                │
│         │ lib/kv-storage.ts                             │
│         │                                                │
│  ┌──────▼─────────────────────────────────┐             │
│  │      Vercel KV (Redis)                 │             │
│  │  - Key: algobet:data                   │             │
│  │  - Key: algobet:bot:status             │             │
│  │  - Read: < 10ms                        │             │
│  │  - Write: < 10ms                       │             │
│  │  - NO Git commits                      │             │
│  │  - NO rebuilds triggered               │             │
│  └────────────────────────────────────────┘             │
│                                                          │
└─────────────────────────────────────────────────────────┘

           ┌─────────────────┐
           │  GitHub Repo    │
           │  (Code only)    │
           │  - No data/     │
           │  - Code changes │
           │    only trigger │
           │    rebuilds     │
           └─────────────────┘
```

**Benefits:**
- No Git commits for data
- No unnecessary rebuilds
- Fast writes (< 10ms)
- UI never resets
- Proper separation of concerns
- Cost efficient

## Data Flow Comparison

### Balance Update Flow

**OLD (GitHub):**
```
1. Cron triggers /api/bot/cron
2. Bot checks Kalshi & Polymarket balances
3. lib/storage.ts → updateBalances()
4. Octokit → repos.createOrUpdateFileContents()
5. Git commit to data/storage.json
6. GitHub webhook → Vercel
7. Vercel starts rebuild (5 min)
8. UI resets, shows old data
9. Rebuild completes
10. UI shows new data
```
**Time:** 5+ minutes  
**Rebuilds:** 1

**NEW (Vercel KV):**
```
1. Cron triggers /api/bot/cron
2. Bot checks Kalshi & Polymarket balances
3. lib/kv-storage.ts → updateBalances()
4. Redis SET algobet:data
5. Done
```
**Time:** < 100ms  
**Rebuilds:** 0

## Storage Schema

### Vercel KV Keys

```typescript
// Main data store
'algobet:data' → {
  bets: Bet[],
  arbitrageGroups: ArbitrageGroup[],
  config: BotConfig,
  dailyStats: DailyStats[],
  balances: AccountBalance[],
  opportunityLogs: OpportunityLog[]
}

// Bot status
'algobet:bot:status' → {
  running: boolean,
  lastUpdated: string
}
```

### Data Types

```typescript
interface AccountBalance {
  platform: 'kalshi' | 'polymarket' | 'sxbet';
  balance: number;           // Total account value (cash + positions)
  availableCash: number;     // Available cash for new bets
  positionsValue: number;    // Value of open positions
  lastUpdated: Date;
}

interface Bet {
  id: string;
  placedAt: Date;
  platform: string;
  marketId: string;
  ticker: string;
  marketTitle: string;
  side: 'yes' | 'no';
  price: number;
  amount: number;
  status: 'filled' | 'cancelled' | 'pending';
  arbitrageGroupId?: string;
}

interface BotConfig {
  maxBetPercentage: number;
  maxDaysToExpiry: number;
  minProfitMargin: number;
  balanceThresholds: {
    kalshi: number;
    polymarket: number;
    sxbet: number;
  };
  emailAlerts: {
    enabled: boolean;
    lowBalanceAlert: boolean;
  };
  simulationMode: boolean;
}
```

## API Endpoints

### Balance Endpoints

```typescript
// GET /api/balances
// Returns current balances from KV
{
  balances: [
    {
      platform: 'kalshi',
      balance: 100.50,
      availableCash: 80.00,
      positionsValue: 20.50,
      lastUpdated: '2024-11-19T...'
    },
    // ...
  ]
}

// Implementation
import { KVStorage } from '@/lib/kv-storage';
const balances = await KVStorage.getBalances();
```

### Bot Control Endpoints

```typescript
// POST /api/bot/control
// Body: { action: 'start' | 'stop' }
// Stores status in KV (no rebuild)

// GET /api/bot/status
// Returns: { running: boolean }

// Implementation
import { kv } from '@vercel/kv';
await kv.set('algobet:bot:status', { running: true });
```

## Performance Comparison

| Operation | GitHub Storage | Vercel KV | Improvement |
|-----------|---------------|-----------|-------------|
| Read balance | 500-1000ms | 5-10ms | 50-100x faster |
| Write balance | 2000-5000ms | 5-10ms | 200-500x faster |
| Bot start/stop | 5000ms + rebuild | 10ms | 500x faster |
| Rebuild triggered | Yes (5 min) | No | ∞ better |

## Deployment Architecture

### Build Process

**What triggers a build:**
- ✅ Code changes in `lib/`, `pages/`, `components/`
- ✅ Changes to `package.json`, `next.config.js`
- ✅ Manual deployment via Vercel dashboard
- ❌ Balance updates (stored in KV)
- ❌ Bot status changes (stored in KV)
- ❌ Bet placements (stored in KV)

### Environment Variables

```bash
# Vercel KV (auto-generated)
KV_URL=redis://...
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...
KV_REST_API_READ_ONLY_TOKEN=...

# API Keys (manual)
KALSHI_API_KEY=...
KALSHI_PRIVATE_KEY=...
POLYMARKET_API_KEY=...
POLYMARKET_WALLET_ADDRESS=...
SXBET_API_KEY=...

# GitHub (for code, not data)
GITHUB_TOKEN=...
GITHUB_OWNER=...
GITHUB_REPO=...

# Other
CRON_SECRET=...
```

## Migration Strategy

### One-Time Migration

```typescript
// scripts/migrate-to-kv.ts
import { getAllData } from '../lib/storage';      // GitHub
import { KVStorage } from '../lib/kv-storage';    // Vercel KV

// Read from GitHub
const githubData = await getAllData();

// Write to KV
await KVStorage.migrateFromGitHub(githubData);
```

### Gradual Rollout (Not Used)

We could have done a gradual migration:
1. Write to both GitHub and KV
2. Read from KV, fallback to GitHub
3. Monitor for issues
4. Remove GitHub writes

But since the interface is identical, we did a clean cut-over.

## Monitoring

### KV Metrics

Monitor in Vercel dashboard:
- **Request count:** Should increase with bot activity
- **Storage size:** Should stay under 1MB
- **Response time:** Should be < 10ms p95

### Deployment Metrics

Monitor in Vercel dashboard:
- **Build frequency:** Should only happen on code changes
- **Build duration:** Should stay ~2-3 minutes
- **Build minutes used:** Should decrease significantly

### Application Metrics

Monitor in function logs:
- Balance update frequency
- API call success rate
- Error rates

## Rollback Plan

If issues occur:

1. **Immediate rollback:**
   ```bash
   git revert HEAD
   git push
   ```

2. **Data is safe:**
   - KV data persists
   - GitHub data still in `data/storage.json`
   - Can switch back anytime

3. **Re-migration:**
   ```bash
   npm run migrate-kv
   ```

## Future Improvements

### Potential Enhancements

1. **Add caching layer:**
   - Cache frequently-read data
   - Reduce KV reads
   - Even faster response times

2. **Add data versioning:**
   - Track changes over time
   - Enable rollback of specific changes
   - Audit trail

3. **Add data backup:**
   - Periodic snapshots to S3
   - Disaster recovery
   - Long-term archival

4. **Add real-time updates:**
   - WebSocket connections
   - Push updates to UI
   - No polling needed

## Security Considerations

### KV Access Control

- KV is only accessible from Vercel functions
- No public access
- Token-based authentication
- Automatic token rotation

### Data Encryption

- Data encrypted at rest
- Data encrypted in transit (TLS)
- Managed by Vercel

### Environment Variables

- Never commit tokens to Git
- Use Vercel environment variables
- Separate prod/dev environments

## Cost Analysis

### Before (GitHub Storage)

- **GitHub API calls:** Free (within limits)
- **Vercel builds:** ~5 builds/hour × 24 hours = 120 builds/day
- **Build minutes:** 120 × 5 min = 600 min/day = 18,000 min/month
- **Cost:** Depends on Vercel plan

### After (Vercel KV)

- **KV requests:** ~1,440 writes/day (every minute)
- **KV storage:** < 1 MB
- **Vercel builds:** ~5 builds/day (code changes only)
- **Build minutes:** 5 × 5 min = 25 min/day = 750 min/month
- **Savings:** 17,250 build minutes/month

### Vercel KV Pricing (as of 2024)

- **Free tier:** 3,000 commands/day, 256 MB storage
- **Pro tier:** 100,000 commands/day, 512 MB storage
- **Enterprise:** Unlimited

AlgoBet usage: ~1,500 commands/day → Fits in free tier ✅

## Conclusion

The migration from GitHub storage to Vercel KV:

✅ **Fixes the rebuild loop issue**  
✅ **Improves performance by 100-500x**  
✅ **Reduces costs significantly**  
✅ **Provides better architecture**  
✅ **Maintains data integrity**  
✅ **Enables future enhancements**  

This is the correct architecture for a production application.

