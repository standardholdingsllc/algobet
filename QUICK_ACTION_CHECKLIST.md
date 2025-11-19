# 🚀 QUICK ACTION CHECKLIST - Fix Kalshi 401 Errors

## ⚠️ IMMEDIATE ACTION REQUIRED

Your API key is exposed in logs and likely revoked. Follow these steps:

---

## ✅ Step-by-Step Fix (15 minutes)

### 1️⃣ Regenerate Kalshi API Key (5 min)

```bash
# Go to: https://kalshi.com/dashboard/api-keys
# 
# 1. Click "Revoke" on key: 9901b2a2-76f3-4aae-a65e-e1ff254986fd
# 2. Click "Create New API Key"
# 3. Download the .pem file (DO NOT copy/paste from browser)
# 4. Save the API Key ID shown on screen
```

---

### 2️⃣ Update Local .env File (2 min)

Edit your `.env` file:

```bash
# Replace with your NEW credentials
KALSHI_API_KEY=<paste-new-key-id-here>
KALSHI_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
<paste-private-key-here>
-----END PRIVATE KEY-----"
```

**Important:** 
- Keep the quotes around the private key
- Include the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines
- Use actual newlines (not `\n`)

---

### 3️⃣ Test Locally (1 min)

```bash
node scripts/test-kalshi-auth.js
```

**Expected output:**
```
✅ SUCCESS! Authentication worked!
Balance: $XXX.XX USD
Your Kalshi credentials are working correctly! 🎉
```

**If you get errors:**
- Check the private key format
- Make sure there are no extra spaces or characters
- Try: `node scripts/format-kalshi-key.js`

---

### 4️⃣ Update Vercel Environment (3 min)

```bash
# Update API key
vercel env add KALSHI_API_KEY production
# Paste your new key when prompted

# Update private key
vercel env add KALSHI_PRIVATE_KEY production
# Paste your new private key when prompted
```

**Verify:**
```bash
vercel env ls
```

You should see both `KALSHI_API_KEY` and `KALSHI_PRIVATE_KEY` listed.

---

### 5️⃣ Deploy Fixed Code (2 min)

```bash
# Stage changes
git add .gitignore lib/markets/kalshi.ts scripts/test-kalshi-auth.js

# Commit
git commit -m "fix: correct Kalshi signature generation and secure logs"

# Push to deploy
git push origin main
```

Vercel will automatically deploy. Wait ~2 minutes for deployment to complete.

---

### 6️⃣ Verify Production (2 min)

1. Go to Vercel dashboard
2. Wait for next cron job to run (happens every minute)
3. Check logs

**Success looks like:**
```
[2025-11-XX] Scanning for arbitrage opportunities...
Kalshi balance: $XXX.XX
Found X Kalshi markets
```

**Failure looks like:**
```
Error fetching Kalshi balance: 401
```

If you still see 401:
- Wait for Vercel deployment to complete
- Check that env vars are set correctly: `vercel env ls`
- Verify the new key is active in Kalshi dashboard

---

## 🎯 What Was Fixed

Your senior dev identified these issues correctly:

1. ✅ **API Key Exposed** - Needs regeneration (YOU MUST DO THIS)
2. ✅ **Signature Body Handling** - Fixed to guarantee empty string for GET requests
3. ✅ **Content-Type Header** - Now only sent when there's a request body
4. ✅ **Security** - Added logs to .gitignore to prevent future exposure

---

## 📋 Verification Checklist

After completing all steps:

- [ ] Old API key revoked in Kalshi dashboard
- [ ] New API key generated
- [ ] Local test passes: `node scripts/test-kalshi-auth.js`
- [ ] Vercel env vars updated (both KEY and PRIVATE_KEY)
- [ ] Code pushed to main branch
- [ ] Vercel deployment completed
- [ ] Next cron run shows balance (not 401 error)
- [ ] logs.txt added to .gitignore
- [ ] logs.txt removed from git: `git rm --cached logs.txt` (optional but recommended)

---

## 🆘 Troubleshooting

### Still getting 401 after all steps?

1. **Check Kalshi dashboard:**
   - Is the new key enabled?
   - Does it have the correct permissions?

2. **Check environment variables:**
   ```bash
   vercel env ls
   ```
   Both `KALSHI_API_KEY` and `KALSHI_PRIVATE_KEY` should be listed.

3. **Test the key format:**
   ```bash
   node scripts/test-current-vercel-key.js
   ```

4. **Check private key length:**
   ```bash
   node scripts/verify-kalshi-key-length.js
   ```

5. **Try formatting the key:**
   ```bash
   node scripts/format-kalshi-key.js
   ```

---

## 📚 More Information

For detailed technical analysis, see:
- `KALSHI_FIX_SUMMARY.md` - Complete technical breakdown
- `KALSHI_401_FIX.md` - Troubleshooting guide
- `KALSHI_IMPLEMENTATION_CLEANUP.md` - Code architecture notes

---

## ⏱️ Estimated Time

- Regenerate API key: **5 minutes**
- Update local .env: **2 minutes**
- Test locally: **1 minute**
- Update Vercel: **3 minutes**
- Deploy code: **2 minutes**
- Verify: **2 minutes**

**TOTAL: ~15 minutes** 🚀

---

## 🎉 Success!

Once you see this in your Vercel logs, you're done:

```
[2025-11-XX] Scanning for arbitrage opportunities...
Kalshi balance: $XXX.XX
Polymarket balance: $XXX.XX
Found X opportunities
```

No more 401 errors! 🎊

