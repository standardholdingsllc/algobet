# Kalshi Implementation - Cleanup Needed

## ⚠️ ISSUE: Duplicate Kalshi Implementations

Your codebase has TWO different Kalshi API implementations:

### ✅ CORRECT Implementation (PRODUCTION - IN USE)
**File:** `lib/markets/kalshi.ts`
- **Class:** `KalshiAPI`
- **Auth Method:** ✅ Correct RSA signature authentication
  - Uses `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-SIGNATURE`, `KALSHI-ACCESS-TIMESTAMP` headers
  - Signs requests with private key
  - Follows Kalshi's official authentication scheme
- **Used By:** `lib/bot.ts` → `pages/api/bot/cron.ts` (PRODUCTION)
- **Status:** ✅ FIXED (improved body handling and header logic)

### ❌ WRONG Implementation (UNUSED)
**File:** `services/kalshi.ts`
- **Class:** `KalshiService`
- **Auth Method:** ❌ INCORRECT Bearer token authentication
  - Uses `Authorization: Bearer ${apiKey}` header
  - This is NOT how Kalshi API works
  - Will ALWAYS get 401 Unauthorized
- **Used By:** `workers/scanner.ts` (NOT used in production)
- **Status:** ❌ SHOULD BE REMOVED or FIXED

---

## 🎯 Recommendation

### Option 1: DELETE the wrong implementation (Recommended)

Since `services/kalshi.ts` is NOT used in production and has wrong authentication:

```bash
# Remove unused files
rm services/kalshi.ts
rm workers/scanner.ts
```

### Option 2: FIX the wrong implementation

If you need `services/kalshi.ts` for some reason, update it to use the same auth logic as `lib/markets/kalshi.ts`:

1. Copy the `generateAuthHeaders()` method from `lib/markets/kalshi.ts`
2. Copy the `formatPrivateKey()` method
3. Update all API calls to use signature auth instead of Bearer token

---

## 📋 Files Analysis

### Production Flow (CORRECT):
```
pages/api/bot/cron.ts
  → imports ArbitrageBotEngine from lib/bot.ts
    → uses KalshiAPI from lib/markets/kalshi.ts
      → ✅ Uses correct signature auth
```

### Unused Flow (WRONG):
```
workers/scanner.ts (NOT USED IN PRODUCTION)
  → uses KalshiService from services/kalshi.ts
    → ❌ Uses wrong Bearer auth
```

---

## ✅ Status

- [x] Fixed production implementation (`lib/markets/kalshi.ts`)
- [ ] Remove or fix unused implementation (`services/kalshi.ts`)
- [ ] Remove unused worker (`workers/scanner.ts`)

The production code is now correct! The 401 errors should be fixed once you regenerate your API key.

