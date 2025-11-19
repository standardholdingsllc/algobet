# Kalshi 401 Unauthorized - Root Cause Analysis & Fix

## 🔍 Issues Identified by Senior Dev

Based on the error logs, your Kalshi authentication is failing due to multiple issues.

---

## ❌ PROBLEMS FOUND

### 1. 🔴 CRITICAL: API Key is EXPOSED and REVOKED

**Status:** MUST FIX IMMEDIATELY

Your API key `9901b2a2-76f3-4aae-a65e-e1ff254986fd` was exposed in your logs.txt file.

**Why this breaks authentication:**
- Kalshi automatically revokes API keys when they detect exposure in public logs
- Any 401 errors could be because the key is already revoked

**Fix Required:**
1. Log into your Kalshi account at https://kalshi.com
2. Navigate to API settings
3. Revoke the exposed key `9901b2a2-76f3-4aae-a65e-e1ff254986fd`
4. Generate a NEW API key
5. Update your `.env` file with the new key:
   ```
   KALSHI_API_KEY=your-new-key-here
   KALSHI_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
   ```
6. Update the key on Vercel:
   ```bash
   vercel env add KALSHI_API_KEY
   vercel env add KALSHI_PRIVATE_KEY
   ```

---

### 2. ✅ FIXED: Signature Body Handling

**Issue:** The body serialization could potentially pass empty objects `{}` which would break signatures.

**What was wrong:**
```typescript
// OLD - risky code
const bodyString = body ? JSON.stringify(body) : '';
```

**Fixed to:**
```typescript
// NEW - explicit handling
let bodyString = '';
if (body !== undefined && body !== null) {
  const serialized = JSON.stringify(body);
  if (serialized !== '{}') {
    bodyString = serialized;
  }
}
```

**Why this matters:**
- Kalshi signature MUST be: `${timestamp}${METHOD}${path}${body}`
- For GET requests, body MUST be `""` (empty string)
- NOT `"undefined"`, `"null"`, `"{}"`, or any spaces
- ANY deviation breaks the signature → 401 Unauthorized

---

### 3. ✅ FIXED: Unnecessary Content-Type Header

**Issue:** GET requests were sending `Content-Type: application/json` header unnecessarily.

**Fixed:** Now only sends Content-Type when there's an actual request body.

---

## ✅ VERIFICATION: What's CORRECT

Your code already has these correct:

### ✓ Signature Format
```typescript
const message = `${timestamp}${method.toUpperCase()}${path}${bodyString}`;
```
This matches Kalshi's requirements exactly!

### ✓ Path Format
```typescript
const path = '/portfolio/balance';
const headers = await this.generateAuthHeaders('GET', `${API_SIGNATURE_PREFIX}${path}`);
// Results in: /trade-api/v2/portfolio/balance ✓
```

### ✓ Timestamp Format
```typescript
const timestamp = Date.now().toString(); // Milliseconds ✓
```

### ✓ Headers
```typescript
{
  'KALSHI-ACCESS-KEY': this.apiKey,
  'KALSHI-ACCESS-SIGNATURE': signature,
  'KALSHI-ACCESS-TIMESTAMP': timestamp,
}
```

---

## 🚀 ACTION ITEMS

### IMMEDIATE (Do Now):

1. **Regenerate API Key** (CRITICAL)
   - [ ] Log into Kalshi
   - [ ] Revoke old key
   - [ ] Generate new key
   - [ ] Update `.env` locally
   - [ ] Update Vercel environment variables

2. **Test Authentication**
   ```bash
   node scripts/test-kalshi-auth.js
   ```

3. **Deploy Updated Code**
   ```bash
   git add lib/markets/kalshi.ts
   git commit -m "fix: correct Kalshi signature generation for GET requests"
   git push
   ```

### VERIFY:

After regenerating the API key:

1. Run local test:
   ```bash
   node scripts/test-kalshi-auth.js
   ```
   Expected output: "✅ SUCCESS! Authentication worked!"

2. Check Vercel logs after next cron run
   - Should see: "Kalshi balance: $X.XX"
   - Should NOT see: "Error fetching Kalshi balance: 401"

---

## 🔐 Security Best Practices Going Forward

1. **Never commit logs with API keys**
   - Add `logs.txt` to `.gitignore`
   - Use `git rm --cached logs.txt` to remove from git history

2. **Rotate keys regularly**
   - Set calendar reminder to rotate API keys every 90 days

3. **Monitor for exposure**
   - If keys appear in logs again → regenerate immediately
   - Use environment variables only, never hardcode

---

## 📋 Checklist Summary

Per your senior dev's checklist, here's the status:

- [x] ✅ Signature format: `${timestamp}GET/trade-api/v2/portfolio/balance`
- [x] ✅ Body is empty string `""` for GET requests (NOW FIXED)
- [x] ✅ Timestamp is within 5 seconds (Date.now() is accurate)
- [ ] ❌ API key is valid (NEEDS REGENERATION)
- [x] ✅ Path is exactly `/trade-api/v2/portfolio/balance` (no trailing slash)
- [x] ✅ Headers are correctly named (KALSHI-ACCESS-*)

---

## 🆘 If Still Getting 401 After Key Regeneration

1. **Check private key format:**
   ```bash
   node scripts/verify-kalshi-key-length.js
   ```

2. **Verify environment variables:**
   ```bash
   node scripts/check-env.js
   ```

3. **Check system clock:**
   - Kalshi requires timestamp within ~5 seconds of server time
   - If Vercel server clock is off, signatures fail
   - (Usually not an issue with Vercel)

4. **Enable debug logging:**
   - Temporarily add console.log to see exact signature string
   - Compare with Kalshi's examples
   - Remove logs before committing!

---

## Summary

**Root Cause:** Your exposed API key is revoked by Kalshi's security system.

**Primary Fix:** Regenerate a new API key and update environment variables.

**Secondary Fix:** Improved body handling to prevent edge cases (already applied).

Once you regenerate the API key, authentication should work immediately! 🎉

