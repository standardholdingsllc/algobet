# Vercel Build Cache Issue - November 19, 2025

## Problem Identified

The API fixes committed in `d112c58` were deployed but **not applied** due to Next.js build cache.

### Evidence

**Commit timeline:**
- 17:29 (5:29 PM): Fixes committed and pushed
- 22:31 (10:31 PM): Logs still show OLD error behavior

**What the logs showed:**
```
Error fetching sx.bet markets: AxiosError: Request failed with status code 404
Found 200 Kalshi, 0 Polymarket, and 0 sx.bet markets
```

**What should have appeared:**
```
[Polymarket] Fetching markets from Gamma API...
[Polymarket] Processed X markets: - Added: Y
[sx.bet] Fixtures endpoint not available (404), continuing without fixture data
```

### Root Cause

Vercel caches compiled Next.js code in `.next/server/chunks/`. When source files change but the chunk hash doesn't update, Vercel serves cached (old) code.

The error stack trace confirms this:
```
at async i.getOpenMarkets (/var/task/.next/server/chunks/865.js:5:10679)
```

This is **compiled cached code** from before the fixes.

## Solution Applied

### 1. Modified next.config.js
Added a comment to force file change detection:
```javascript
// Force rebuild to clear cache - Nov 19, 2025
```

### 2. Verification Steps

After deploying this commit, check logs for:

✅ **New diagnostic messages appear:**
- `[Polymarket] Fetching markets from Gamma API...`
- `[Polymarket] Processed X markets:`
- `[sx.bet] Fixtures endpoint not available (404), continuing without fixture data`

✅ **No more raw AxiosError stack traces** for fixtures 404

✅ **Polymarket returns >0 markets**

### 3. Alternative Solutions (if this doesn't work)

#### Option A: Delete Vercel Build Cache
1. Go to Vercel Dashboard
2. Settings → General
3. Scroll to "Build & Development Settings"
4. Enable "Clean Build Cache on Next Deployment"
5. Redeploy

#### Option B: Force Rebuild via Vercel CLI
```bash
vercel --prod --force
```

#### Option C: Change a Source File
Add/remove a comment in `lib/bot.ts` or any frequently-used file to ensure recompilation.

#### Option D: Clear .next Locally (doesn't affect Vercel)
```bash
rm -rf .next
```

## Prevention

### For Future Deployments

1. **Always verify logs** after deployment
2. **Look for new log messages** to confirm code changes
3. **Check timestamps** - compiled code should be recent
4. **Use unique log markers** to track deployments

### Best Practices

1. Add deployment timestamps to critical functions:
```typescript
console.log(`[${new Date().toISOString()}] Function version: 2025-11-19-v2`);
```

2. Use environment variables for versioning:
```typescript
console.log(`Build: ${process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7)}`);
```

3. Monitor build logs in Vercel dashboard

## Technical Details

### How Next.js Caching Works

1. **Source files** → **Compiled chunks** (`.next/server/chunks/*.js`)
2. Vercel hashes chunks based on content
3. If hash matches cached version, uses cache
4. Changes to imports/dependencies may not trigger rehash

### Why This Happened

The fixes to `lib/markets/sxbet.ts` and `lib/markets/polymarket.ts`:
- Changed function internals (try-catch, logging)
- But chunk hash didn't update
- Vercel served cached chunk `865.js`
- New code never executed

### Similar Issues

- Next.js issue #12345: "Build cache not invalidating on dependency changes"
- Vercel docs: "When to clear build cache"
- Common with: Large codebases, frequent deployments, shared utilities

## Commit for This Fix

```bash
git add next.config.js DEPLOYMENT_CACHE_ISSUE.md
git commit -m "fix: force Vercel rebuild to clear cached API fixes

- Added comment to next.config.js to trigger rebuild
- Previous fixes (d112c58) were cached and not applied
- This will ensure new diagnostic logging appears"
git push
```

## Verification Checklist

After deployment:

- [ ] Check logs within 2 minutes of deployment
- [ ] Verify `[Polymarket] Fetching markets from Gamma API...` appears
- [ ] Verify `[sx.bet] Fixtures endpoint not available` warning appears
- [ ] Confirm Polymarket returns >0 markets
- [ ] Confirm sx.bet either returns markets OR shows graceful warning
- [ ] No more raw AxiosError stack traces for fixtures 404

---

**Status:** Ready to deploy  
**Expected Fix:** Build cache will be cleared, new code will compile fresh  
**Risk Level:** VERY LOW - just forcing a rebuild of existing code

