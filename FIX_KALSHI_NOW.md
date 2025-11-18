# Fix Kalshi Authentication - Step by Step

Your current key is corrupted/incomplete. Follow these steps exactly to fix it.

---

## Part 1: Get New Key from Kalshi

### Step 1: Delete Old Key
1. Go to https://kalshi.com/settings/api
2. Find your existing API key
3. Click **Delete** or **Revoke**

### Step 2: Generate Fresh Key
1. Click **"Generate New API Key"**
2. **IMPORTANT: Click "Download" button** - do NOT copy/paste from browser
3. Save the file as `kalshi-key.pem` on your computer

### Step 3: Save API Key ID
You'll see a new API Key (UUID format like `bf7032cd-0348-4988-9396-a479ad7fdc2a`)
- **Copy this** - you'll need it for Vercel

---

## Part 2: Format the Key Correctly

### Option A: Use the Formatting Script (Easiest)

1. Open terminal in your project folder:
   ```bash
   cd "C:\AlgoBet Project\AlgoBet"
   ```

2. Run the formatter with your downloaded key:
   ```bash
   node scripts/format-kalshi-key.js "$(type kalshi-key.pem)"
   ```

3. Copy the entire output (it will look like one long line with `\n`)

### Option B: Manual Format (If Script Fails)

1. Open `kalshi-key.pem` in Notepad
2. You should see something like:
   ```
   -----BEGIN PRIVATE KEY-----
   MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
   (many lines of base64)
   ...
   -----END PRIVATE KEY-----
   ```

3. Convert to single line:
   - Replace every line break with `\n` (backslash + n)
   - Remove any extra spaces
   - Should look like:
   ```
   -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhki...\n-----END PRIVATE KEY-----
   ```

---

## Part 3: Update Vercel Environment Variables

1. **Go to Vercel Dashboard**
   - Open https://vercel.com/dashboard
   - Select your AlgoBet project
   - Go to **Settings** → **Environment Variables**

2. **Update KALSHI_API_KEY**
   - Find `KALSHI_API_KEY`
   - Click **Edit**
   - Paste the NEW API key UUID from Step 2.3
   - Click **Save**

3. **Update KALSHI_PRIVATE_KEY**
   - Find `KALSHI_PRIVATE_KEY`
   - Click **Edit**
   - Paste the FORMATTED key from Part 2 (the long line with `\n`)
   - **CRITICAL**: Make sure there are NO spaces in the base64 content
   - Click **Save**

4. **Verify KALSHI_EMAIL**
   - Make sure this matches your Kalshi account email
   - Update if needed

---

## Part 4: Redeploy

### Method 1: Force Redeploy from Vercel
1. Go to **Deployments** tab
2. Click **⋯** (three dots) on latest deployment
3. Click **Redeploy**
4. Wait ~2 minutes

### Method 2: Push Empty Commit
```bash
cd "C:\AlgoBet Project\AlgoBet"
git commit --allow-empty -m "Trigger redeploy after Kalshi key update"
git push origin main
```

---

## Part 5: Verify It Works

### Check 1: Wait for Deployment
- Watch Vercel dashboard until deployment completes
- Should show "Deployment Ready" with green checkmark

### Check 2: Check Logs
- Wait ~1-2 minutes for next cron scan
- Check logs (your current logs.txt or Vercel logs)

### Look For Success:
```
✅ Kalshi balance: $XXX.XX
✅ No "DECODER routines" errors
✅ Markets loading
```

### If Still Failing:
```
❌ Still seeing "DECODER routines::unsupported"
```

If still failing, the key file itself might be corrupted. Try:
1. Generate a NEW key again (delete and regenerate)
2. Make sure you DOWNLOAD the file, don't copy from browser
3. Verify the file is not empty or corrupted

---

## Expected Key Format

### Good Key Looks Like:
- **Length**: 1600-1900 characters
- **Lines**: 25-30 lines
- **Header**: `-----BEGIN PRIVATE KEY-----`
- **Footer**: `-----END PRIVATE KEY-----`
- **Content**: Base64 characters only (A-Z, a-z, 0-9, +, /, =)

### Your Current Key (BAD):
- **Length**: 1187 characters ❌ (too short)
- **Lines**: 19 lines ❌ (too few)
- This indicates missing data

---

## Common Mistakes to Avoid

❌ **Don't** copy/paste key from Kalshi website  
✅ **Do** download the .pem file

❌ **Don't** leave actual newlines in Vercel env var  
✅ **Do** use literal `\n` (backslash + n)

❌ **Don't** add spaces between base64 chunks  
✅ **Do** keep it as one continuous string with `\n` only

❌ **Don't** forget to update API_KEY along with PRIVATE_KEY  
✅ **Do** update both at the same time

---

## Troubleshooting

### "I can't find the Download button"
- Look for "Download Private Key" or a download icon
- It should download a `.pem` file
- If not available, the key might be shown as text - carefully copy ALL of it

### "The formatting script gives an error"
- Make sure you're in the AlgoBet project directory
- Try the manual method instead (Part 2, Option B)
- Make sure the .pem file path is correct

### "Vercel still shows errors after update"
- Make sure you clicked Save after editing env vars
- Verify you redeployed (deployment should show recent timestamp)
- Check you updated the RIGHT project in Vercel
- Try clearing browser cache and checking again

### "Balance is still $0.00"
- Wait at least 3-4 minutes after deployment
- Check Vercel logs (not just logs.txt) for errors
- Verify the bot is enabled (not disabled)
- Try regenerating the key one more time

---

## Quick Checklist

Before asking for help, verify:

- [ ] Downloaded fresh .pem file from Kalshi (not copy/paste)
- [ ] Key file is 1600+ characters
- [ ] Formatted with `\n` separators (not spaces or actual newlines)
- [ ] Updated BOTH `KALSHI_API_KEY` and `KALSHI_PRIVATE_KEY` in Vercel
- [ ] Both are from the SAME new key generation
- [ ] Clicked Save in Vercel
- [ ] Redeployed the application
- [ ] Waited 3+ minutes after deployment
- [ ] Checked Vercel deployment logs for success

---

## Still Not Working?

If you've followed ALL steps and it still fails:

1. **Screenshot the error** from Vercel logs
2. **Verify key length** in the .pem file
3. **Try OpenSSL test** (if you have it):
   ```bash
   openssl rsa -in kalshi-key.pem -check -noout
   ```
   This will tell you if the key file itself is valid

4. **Contact Kalshi support** and ask:
   - "My private key appears corrupted, can you help?"
   - "What format should the downloaded key be in?"
   - "Can I get a key in PKCS#8 format?"

