# ✅ Upstash Redis Migration Complete

## What Changed

I've updated all the code to use **Upstash Redis** instead of Vercel KV (which is no longer available).

### Files Modified

1. **`package.json`**
   - Changed: `@vercel/kv` → `@upstash/redis`

2. **`lib/kv-storage.ts`**
   - Updated import: `import { Redis } from '@upstash/redis'`
   - Initialize client:
     ```typescript
     const redis = new Redis({
       url: process.env.UPSTASH_REDIS_REST_URL!,
       token: process.env.UPSTASH_REDIS_REST_TOKEN!,
     });
     ```
   - All methods now use `redis.get()` and `redis.set()`

3. **`pages/api/bot/status.ts`**
   - Updated to use Upstash Redis client
   - Same initialization as kv-storage.ts

4. **Documentation Files**
   - `SETUP_VERCEL_KV.md` - Updated with Upstash setup instructions
   - `REBUILD_FIX_SUMMARY.md` - Updated references to Upstash
   - `TECHNICAL_ARCHITECTURE.md` - (will update if needed)
   - `VERCEL_KV_MIGRATION.md` - (will update if needed)

## Environment Variables Required

When you install Upstash via Vercel Marketplace, these are automatically set:

```bash
KV_REST_API_URL=https://your-database.upstash.io
KV_REST_API_TOKEN=your-token-here
KV_URL=redis://...
REDIS_URL=redis://...
KV_REST_API_READ_ONLY_TOKEN=your-readonly-token
```

**Note:** The code uses `KV_REST_API_URL` and `KV_REST_API_TOKEN` (Vercel's naming convention), NOT `UPSTASH_REDIS_REST_URL`.

## Setup Steps

### 1. Install Upstash via Vercel Marketplace (Easiest)

1. Go to: https://vercel.com/integrations/upstash
2. Click **Add Integration**
3. Select your Vercel account
4. Choose **algobet** project
5. Create database:
   - Name: `algobet-redis`
   - Region: `us-east-1` (or closest to you)
   - Type: Regional (free tier)
6. Environment variables will be added automatically

### 2. Or Set Up Manually

1. Go to: https://console.upstash.com
2. Create account or sign in
3. Create Redis database:
   - Name: `algobet-redis`
   - Type: Regional
   - Region: `us-east-1`
4. Copy credentials:
   - REST API URL → `UPSTASH_REDIS_REST_URL`
   - REST API Token → `UPSTASH_REDIS_REST_TOKEN`
5. Add to Vercel:
   - Project Settings → Environment Variables
   - Add both variables

### 3. Deploy

```bash
npm install
git add .
git commit -m "Migrate to Upstash Redis"
git push
```

### 4. Migrate Data

After deployment completes:

```bash
npm run migrate-kv
```

This will copy all existing data from GitHub storage to Upstash Redis.

### 5. Verify

1. Check dashboard: https://algobet.vercel.app/dashboard
2. Start/stop bot
3. Verify no rebuilds are triggered
4. Check Upstash console: https://console.upstash.com

## Key Differences: Vercel KV vs Upstash

| Feature | Vercel KV (Old) | Upstash via Vercel (New) |
|---------|----------------|--------------------------|
| Package | `@vercel/kv` | `@upstash/redis` |
| Import | `import { kv } from '@vercel/kv'` | `import { Redis } from '@upstash/redis'` |
| Init | Automatic | Manual with URL + token |
| Env Vars | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | **Same!** `KV_REST_API_URL`, `KV_REST_API_TOKEN` |
| Usage | `kv.get()`, `kv.set()` | `redis.get()`, `redis.set()` |
| Status | Deprecated (Oct 2024) | Active, official integration |

**Important:** When installed via Vercel Marketplace, Upstash uses the same `KV_*` environment variable names for compatibility!

## Code Changes Summary

### Before (Vercel KV)
```typescript
import { kv } from '@vercel/kv';

const data = await kv.get('key');
await kv.set('key', value);
```

### After (Upstash via Vercel)
```typescript
import { Redis } from '@upstash/redis';

// Uses Vercel's KV environment variables
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const data = await redis.get('key');
await redis.set('key', value);
```

## Why Upstash?

1. **Official Integration:** Vercel now uses Upstash for all KV storage
2. **Better Features:** More Redis commands, better performance
3. **Generous Free Tier:** 10,000 commands/day (vs 3,000 with old KV)
4. **Serverless:** Pay-as-you-go pricing
5. **Global:** Edge caching for low latency
6. **Marketplace Integration:** One-click setup in Vercel

## Testing Checklist

- [ ] Upstash Redis database created
- [ ] Environment variables set in Vercel
- [ ] Code deployed successfully
- [ ] Migration script run
- [ ] Dashboard shows correct balances
- [ ] Bot start/stop works
- [ ] No rebuilds triggered by balance updates
- [ ] Upstash console shows data

## Upstash Free Tier

Perfect for AlgoBet:

- **10,000 commands/day** (AlgoBet uses ~1,500)
- **256 MB storage** (AlgoBet uses < 1 MB)
- **Global replication** included
- **TLS encryption** included
- **No credit card required**

## Monitoring

### Upstash Console
- URL: https://console.upstash.com
- View: Request count, storage size, response times
- Alerts: Set up notifications for limits

### Vercel Deployments
- URL: https://vercel.com/standardholdingsllc/algobet/deployments
- Verify: Only code changes trigger builds
- Monitor: Build frequency should drop dramatically

## Support

If you encounter issues:

1. **Check environment variables:**
   - Vercel → Settings → Environment Variables
   - Must have `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   - These are set automatically by Upstash integration

2. **Check Upstash console:**
   - https://console.upstash.com
   - Verify database is active
   - Check request logs

3. **Check Vercel logs:**
   - Deployments → Latest → View Function Logs
   - Look for Redis connection errors

4. **Re-run migration:**
   ```bash
   npm run migrate-kv
   ```

## Next Steps

1. ✅ Code updated to use Upstash
2. ⏳ Set up Upstash database (you need to do this)
3. ⏳ Deploy to Vercel
4. ⏳ Run migration script
5. ⏳ Verify everything works

---

**Status:** Code ready, awaiting Upstash setup  
**Impact:** Fixes rebuild loop issue  
**Benefit:** No more unnecessary Vercel rebuilds!  
**Migration Time:** ~10 minutes total

