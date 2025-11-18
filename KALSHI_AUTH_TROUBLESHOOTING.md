# Kalshi Authentication Troubleshooting Guide

This guide addresses the specific authentication errors you're experiencing with Kalshi API.

## Your Current Error

```
Error signing Kalshi request: error:1E08010C:DECODER routines::unsupported
```

This error means Node.js crypto module cannot parse your private key format.

---

## Quick Diagnosis

Your key appears to have:
- ✅ Correct headers (`-----BEGIN PRIVATE KEY-----`)
- ✅ Correct structure (19 lines, 1187 characters)
- ❌ But the format is still not compatible with Node.js crypto

### Most Likely Causes

1. **Key format mismatch**: Kalshi might provide `RSA PRIVATE KEY` (PKCS#1) but you labeled it as `PRIVATE KEY` (PKCS#8)
2. **Encoding issues**: The base64 content might have incorrect encoding
3. **Corrupted key**: The key might have been corrupted during copy/paste

---

## Solution 1: Test Your Key Locally (Recommended)

I've created a diagnostic script that will test your key and show exactly what's wrong.

### Run the Test Script

```bash
# Test with your current key from environment
node scripts/test-kalshi-key.js "YOUR_FULL_KEY_HERE"
```

Or if you have it in environment variable:

```bash
KALSHI_PRIVATE_KEY="..." node scripts/test-kalshi-key.js
```

### What the Script Does

1. ✅ Shows key format details
2. ✅ Attempts to format it correctly
3. ✅ Tests cryptographic signing (same as Kalshi API)
4. ✅ Provides specific error messages and solutions

### Example Output

If successful:
```
✅ SUCCESS! Your private key is correctly formatted and working.
```

If failed:
```
❌ Signing failed!
Error: error:1E08010C:DECODER routines::unsupported

💡 Possible solutions:
1. Regenerate key from Kalshi
2. Try RSA PRIVATE KEY format instead
3. Check for corruption
```

---

## Solution 2: Regenerate Key from Kalshi

The safest solution is to generate a fresh key:

### Steps

1. **Login to Kalshi**
   - Go to https://kalshi.com
   - Navigate to Settings → API

2. **Delete Old API Key**
   - Click on your existing API key
   - Click "Delete" or "Revoke"

3. **Generate New API Key**
   - Click "Generate New API Key"
   - **Download the private key file** (don't copy/paste from browser)
   - Save the file as `kalshi-private-key.pem`

4. **Format the Key**

   On Linux/Mac:
   ```bash
   # Convert to single line with \n separators
   awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' kalshi-private-key.pem
   ```

   On Windows (PowerShell):
   ```powershell
   (Get-Content kalshi-private-key.pem -Raw) -replace "`r`n","\n" -replace "`n","\n"
   ```

   Or use the formatting script:
   ```bash
   node scripts/format-kalshi-key.js "$(cat kalshi-private-key.pem)"
   ```

5. **Update Vercel**
   - Go to Vercel Dashboard → Settings → Environment Variables
   - Update `KALSHI_PRIVATE_KEY` with the formatted key
   - Update `KALSHI_API_KEY` with the new API key
   - Click Save
   - Redeploy

---

## Solution 3: Try Both Key Formats

Kalshi might provide keys in either format. Try both:

### Format A: PRIVATE KEY (PKCS#8)

```
-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhki...\n-----END PRIVATE KEY-----
```

### Format B: RSA PRIVATE KEY (PKCS#1)

```
-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----
```

**The updated code now automatically converts between these formats**, but if you're still having issues, try changing the header manually.

---

## Solution 4: Check for Common Issues

### Issue: Extra Whitespace

Make sure there are **no spaces** in your key:

❌ Wrong:
```
...qQuVJCgE pGsl3Jnj0cW8f...
```

✅ Correct:
```
...qQuVJCgEpGsl3Jnj0cW8f...
```

### Issue: Missing Content

Make sure you copied the **entire key**. A typical RSA-2048 key has:
- 1 header line
- ~25-27 lines of base64 content (64 chars each)
- 1 footer line
- Total: ~1700 characters

Your key is 1187 characters with 19 lines, which seems a bit short. This might indicate:
- **Incomplete key copy** - You might have missed some lines
- **RSA-1024 key** - Shorter but less secure (unusual for modern APIs)

### Issue: Line Length Inconsistency

PEM format expects 64 characters per line (except the last one). Check that your key follows this pattern.

---

## Solution 5: Code Fix Deployed

I've updated the code to automatically handle key format conversions. The changes:

1. **Auto-detects RSA PRIVATE KEY** format
2. **Converts PKCS#1 to PKCS#8** automatically
3. **Better error messages** for debugging

### To Apply This Fix

```bash
# Commit the changes
git add lib/markets/kalshi.ts scripts/
git commit -m "Fix Kalshi key format handling with auto-conversion"
git push origin main
```

Vercel will automatically redeploy with the fix.

---

## Solution 6: Manual Key Conversion

If automatic conversion doesn't work, manually convert the key:

### Using OpenSSL (if you have the .pem file)

```bash
# Convert RSA PRIVATE KEY (PKCS#1) to PRIVATE KEY (PKCS#8)
openssl pkcs8 -topk8 -nocrypt -in kalshi-private-key.pem -out kalshi-private-key-pkcs8.pem

# Then format for Vercel
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' kalshi-private-key-pkcs8.pem
```

---

## Verification Steps

After applying any solution:

1. **Check Vercel Logs**
   ```bash
   vercel logs --follow
   ```

2. **Trigger a Test Scan**
   - Go to your dashboard
   - Start the bot
   - Check logs for Kalshi balance fetch

3. **Look for Success Messages**
   ```
   ✅ No "401 Unauthorized" errors
   ✅ No "DECODER routines" errors
   ✅ Kalshi balance fetched successfully
   ```

---

## Understanding the Error

### What is DECODER routines::unsupported?

This OpenSSL error means:
- The key has a format that Node.js crypto doesn't recognize
- Common causes:
  - Wrong key type (PKCS#1 vs PKCS#8)
  - Encrypted/password-protected key
  - Corrupted base64 encoding
  - Unsupported algorithm

### Key Format Types

| Format | Header | Use Case |
|--------|--------|----------|
| PKCS#1 | `-----BEGIN RSA PRIVATE KEY-----` | Traditional RSA keys |
| PKCS#8 | `-----BEGIN PRIVATE KEY-----` | Modern standard, algorithm-agnostic |
| Encrypted | `-----BEGIN ENCRYPTED PRIVATE KEY-----` | Password-protected (not supported) |

Node.js `crypto.createSign()` works best with **PKCS#8** format.

---

## Still Not Working?

If you've tried all solutions and still get errors:

### Option A: Alternative Authentication Method

Check if Kalshi supports other authentication methods:
- Bearer tokens
- API key + secret (without RSA)
- OAuth

Visit: https://docs.kalshi.com/

### Option B: Contact Kalshi Support

- They might have specific requirements for key generation
- Ask for a key in **PKCS#8 format**
- Ask if keys need to be generated in a specific way

### Option C: Debug Deeper

Run the test script with more details:

```bash
# Save your key to a file first (for debugging)
echo "YOUR_KEY" > test-key.pem

# Test with OpenSSL directly
openssl rsa -in test-key.pem -check -noout

# If this fails, the key itself is corrupted
```

---

## Summary Checklist

Before proceeding, ensure:

- [ ] Key has proper headers (`-----BEGIN ... KEY-----`)
- [ ] Key uses `\n` not spaces or actual newlines (for Vercel)
- [ ] No extra whitespace in base64 content
- [ ] Complete key copied (all lines)
- [ ] Tested with `scripts/test-kalshi-key.js`
- [ ] Updated code with auto-conversion fix
- [ ] Redeployed to Vercel
- [ ] Tested after deployment

---

## Quick Recovery

If you need to get back to working state ASAP:

1. **Regenerate everything fresh from Kalshi** ← Start here
2. **Download the .pem file** (don't copy/paste)
3. **Use the format script** on the downloaded file
4. **Update all three variables** in Vercel (KEY, API_KEY, EMAIL)
5. **Redeploy**
6. **Test with the diagnostic script first** (locally)
7. **Then test in production**

This ensures you're starting with a known-good key format.

---

## Need More Help?

Check these files:
- `KALSHI_CREDENTIALS_FORMAT.md` - Detailed formatting guide
- `scripts/test-kalshi-key.js` - Key testing script
- `scripts/format-kalshi-key.js` - Key formatting script

Or check Kalshi's API documentation:
https://docs.kalshi.com/getting_started/authentication

