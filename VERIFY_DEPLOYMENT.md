# Verify Deployment - Quick Checklist

## What Just Happened

**Problem:** Your previous deployment (commit `d112c58`) had the API fixes in the code, but Vercel served **cached compiled code** from before the fixes.

**Solution:** Modified `next.config.js` to force Vercel to rebuild everything fresh.

**New Commit:** `93ec12e` - "fix: force Vercel rebuild to clear cached API fixes"

---

## What to Check (In Order)

### 1. Wait for Deployment (2-3 minutes)

Go to: https://vercel.com/[your-project]/deployments

Watch for:
- ✅ Commit `93ec12e` appears
- ✅ Build completes successfully
- ✅ Status shows "Ready"

### 2. Check Logs IMMEDIATELY After Deployment

**Within 2 minutes of "Ready" status**, check your logs.

### 3. Look for These NEW Messages

You should NOW see:

```
✅ [Polymarket] Fetching markets from Gamma API...
✅ [Polymarket] API Response: X markets received
✅ [Polymarket] Sample market structure: {...}
✅ [Polymarket] Processed X markets:
     - Added: Y
     - Skipped (expired/future): Z
     - Skipped (non-binary): W
     - Skipped (missing tokens): V
```

AND either:
```
✅ [sx.bet] Retrieved X fixtures
```
OR (more likely):
```
⚠️ [sx.bet] Fixtures endpoint not available (404), continuing without fixture data
⚠️ [sx.bet] Skipping market [hash] - no fixture data
```

### 4. The OLD Error Should Be GONE

You should NO LONGER see:
```
❌ Error fetching sx.bet markets: AxiosError: Request failed with status code 404
   at settle (file:///var/task/node_modules/axios/lib/core/settle.js:19:12)
   [500 lines of stack trace...]
```

### 5. Market Counts Should Change

**Before:**
```
Found 200 Kalshi, 0 Polymarket, and 0 sx.bet markets
```

**After:**
```
Found 200 Kalshi, 50-150 Polymarket, and 0-50 sx.bet markets
```

**Note:** SX.bet may still be 0 if:
- No sports games in the next 30 days
- Fixtures endpoint is down (but it won't crash now!)

---

## If You Still See the OLD Error

### Option 1: Clear Build Cache in Vercel

1. Go to Vercel Dashboard
2. Your Project → Settings → General  
3. Scroll to "Build & Development Settings"
4. Find "Build Cache" section
5. Click "Clear Build Cache"
6. Trigger new deployment:
   - Go to Deployments
   - Click "..." on latest deployment
   - Click "Redeploy"

### Option 2: Make Another File Change

```bash
# Add a comment somewhere
echo "// Force rebuild" >> lib/bot.ts
git add lib/bot.ts
git commit -m "chore: force rebuild"
git push
```

### Option 3: Use Vercel CLI

```bash
vercel --prod --force
```

---

## Success Criteria

### ✅ Deployment Successful If:

1. New log messages appear (Polymarket diagnostic output)
2. SX.bet shows warning instead of crash
3. Polymarket returns >0 markets
4. No 500-line stack traces
5. Bot continues running smoothly

### ❌ Still Has Issues If:

1. Still see AxiosError stack trace for fixtures
2. Still getting 0 Polymarket markets
3. No new diagnostic messages
4. Same logs as before

---

## Timeline

- **17:29 (5:29 PM):** Original fixes committed (`d112c58`)
- **22:31 (10:31 PM):** You tested, saw cached code was running
- **Now:** Cache-busting commit pushed (`93ec12e`)
- **Next 3 minutes:** Vercel rebuilds with fresh cache
- **Check logs:** Verify new messages appear

---

## Quick Test Commands

### Check if deployed
```bash
curl https://your-app.vercel.app/api/bot/status
```

### Trigger manual scan
```bash
curl -X POST https://your-app.vercel.app/api/bot/cron?secret=YOUR_CRON_SECRET
```

### View recent logs
Go to: https://vercel.com/[your-project]/logs

---

## What Each Platform Should Show

### Polymarket
```
[Polymarket] Fetching markets from Gamma API...
[Polymarket] API Response: 100 markets received
[Polymarket] Sample market structure: {...}
[Polymarket] Processed 100 markets:
  - Added: 75
  - Skipped (expired/future): 20
  - Skipped (non-binary): 3
  - Skipped (missing tokens): 2

Found 200 Kalshi, 75 Polymarket, and X sx.bet markets
```

### SX.bet (Normal Case - No Fixtures)
```
[sx.bet] Fixtures endpoint not available (404), continuing without fixture data
[sx.bet] Skipping market [hash] - no fixture data
[sx.bet] Skipping market [hash] - no fixture data
...

Found 200 Kalshi, 75 Polymarket, and 0 sx.bet markets
```

### SX.bet (Best Case - Fixtures Work)
```
[sx.bet] Retrieved 50 fixtures
[sx.bet] Processing markets...

Found 200 Kalshi, 75 Polymarket, and 30 sx.bet markets
```

---

## Need Help?

### If Still Seeing Issues

1. **Screenshot your Vercel logs**
2. **Note the timestamp** of the logs
3. **Check commit hash** in Vercel deployment details
4. **Verify** it shows `93ec12e` or later

### Contact Me With:
- Logs (last 100 lines)
- Vercel deployment URL
- Commit hash showing in Vercel
- Timestamp when you checked

---

**Expected Result:** New diagnostic messages appear, Polymarket works, sx.bet fails gracefully.

**ETA:** Should work within 5 minutes of reading this!

Good luck! 🚀

