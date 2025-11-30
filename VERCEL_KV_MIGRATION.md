# Vercel KV Migration Guide

## Problem Solved

Previously, AlgoBet used **GitHub as a database**, which caused:
- ❌ Vercel rebuilds every time balance data was updated (every 5 minutes)
- ❌ Slow write operations (seconds instead of milliseconds)
- ❌ UI reverting to incorrect state during rebuilds
- ❌ Unnecessary build minutes consumed

Now, AlgoBet uses **Vercel KV** (Redis-based key-value store):
- ✅ No rebuilds when data changes
- ✅ Lightning-fast read/write operations (milliseconds)
- ✅ Persistent data across deployments
- ✅ Proper separation of runtime data and build-time code

## Architecture Changes

### Before
```
Bot → GitHub Storage → Git Commit → Vercel Rebuild → UI Update
      (slow, triggers rebuild)
```

### After
```
Bot → Vercel KV → UI Update
      (fast, no rebuild)
```

## Setup Instructions

### 1. Create Vercel KV Database

1. Go to your Vercel dashboard: https://vercel.com/standardholdingsllc/algobet
2. Click **Storage** tab
3. Click **Create Database**
4. Select **KV (Redis)**
5. Name it: `algobet-kv`
6. Click **Create**

Vercel will automatically add these environment variables to your project:
- `KV_URL`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

### 2. Deploy the Changes

The code changes are already in place. Just push to GitHub:

```bash
git add .
git commit -m "Migrate to Vercel KV storage"
git push
```

Vercel will automatically deploy with the KV environment variables.

### 3. Migrate Existing Data

After deployment, run the migration script:

```bash
npm run migrate-kv
```

Or manually via Vercel:
1. Go to your project in Vercel
2. Click **Deployments**
3. Find your latest deployment
4. Click **...** → **View Function Logs**
5. Run: `node -r esbuild-register scripts/migrate-to-kv.ts`

### 4. Verify

1. Check your dashboard: https://algobet.vercel.app/dashboard
2. Verify balances are showing correctly
3. Start the bot and check that balance updates don't trigger rebuilds

## What Changed

### Files Modified

1. **`lib/kv-storage.ts`** (NEW)
   - Vercel KV adapter with same interface as GitHub storage
   - All storage operations now use Redis instead of GitHub

2. **`pages/api/*.ts`**
   - Updated to use `KVStorage` instead of `storage`
   - No functional changes, just different backend

3. **`lib/bot.ts`**
   - Updated to use `KVStorage`
   - Balance updates no longer commit to GitHub

4. **`pages/api/live-arb/status.ts`**
   - Live arb status now stored in KV instead of `data/bot-status.json`

### Files Unchanged

- `data/storage.json` - Still exists as a backup, but not actively used
- `lib/storage.ts` - Kept for migration script
- `lib/github-storage.ts` - Kept for reference

## Testing

### Test Balance Updates

1. Start the bot
2. Watch Vercel deployment logs: https://vercel.com/standardholdingsllc/algobet/deployments
3. Verify that balance checks do NOT trigger new deployments
4. Check dashboard to see balances updating in real-time

### Test Bot Control

1. Stop the bot from dashboard
2. Verify status persists across page refreshes
3. Start the bot again
4. Verify it starts scanning without rebuilding

## Rollback Plan

If something goes wrong, you can rollback:

1. Revert the commit:
   ```bash
   git revert HEAD
   git push
   ```

2. The old GitHub storage will still work since `data/storage.json` is preserved

## Benefits

1. **No More Unnecessary Rebuilds**
   - Balance updates don't trigger Vercel rebuilds
   - Only code changes trigger rebuilds

2. **Faster Operations**
   - KV operations are 10-100x faster than GitHub API
   - Sub-millisecond read/write times

3. **Better Architecture**
   - Proper separation of concerns
   - Runtime data in database, not in Git

4. **Cost Savings**
   - Fewer build minutes consumed
   - Faster deployments

## Monitoring

Check KV usage in Vercel dashboard:
- Go to **Storage** → **algobet-kv**
- Monitor:
  - Request count
  - Storage size
  - Response times

## Support

If you encounter issues:
1. Check Vercel function logs
2. Verify KV environment variables are set
3. Run migration script again if data is missing
4. Contact support with error logs

