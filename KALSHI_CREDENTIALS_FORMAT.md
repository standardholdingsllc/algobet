# Kalshi API Credentials Format Guide

This guide shows the **exact format** required for Kalshi API credentials in Vercel environment variables.

## Required Environment Variables

You need three environment variables for Kalshi:
- `KALSHI_API_KEY`
- `KALSHI_PRIVATE_KEY`
- `KALSHI_EMAIL`

---

## 1. KALSHI_API_KEY

### Correct Format

```
bf7032cd-0348-4988-9396-a479ad7fdc2a
```

### Details
- Simple UUID format
- No quotes, no spaces, no special characters
- Just paste the key exactly as provided by Kalshi

### Example in Vercel
```
Variable Name: KALSHI_API_KEY
Value: bf7032cd-0348-4988-9396-a479ad7fdc2a
```

---

## 2. KALSHI_PRIVATE_KEY

### ⚠️ Most Common Issues
- **Missing headers/footers** (`-----BEGIN PRIVATE KEY-----`)
- **Spaces instead of newlines** between base64 lines
- **Incorrect newline encoding** in environment variables

### Correct Format (for Vercel)

**Use literal `\n` (backslash + n) for line breaks:**

```
-----BEGIN PRIVATE KEY-----\nMIIEpAIBAAKCAQEAmFOdj6ZAhzWO8ickWg8TikXOPnBycUesH6GcH3zy0quVJCgE\npGsl3Jnj0cW8fL/daMLccl9IC/45DMmpGzsiQF/lP06YtOCcGYxf1IEsfY4k8p/K\nMOwBnyZONGuq0nN6IN31KYgJdA8AUiS7E0A9V1yXAFILs2zit7CXuIUfSlU1Sb/j\nkMTaCTv1VJYLPUm5BnHGYMzw0ybYcFqp1Z+Q1vWI4M2kzr2qA2/yXBUf5lxQc8En\nUIsjCA3rzTgXvhh1KYMdALVakGPdQeBdtGXHiXGL3+HdPOpQip5k2TPSAkDdvSMq\nHzHL/Gx/0utP3pRm7+HwUN/ple2zP1loiUrtjQIDAQABAoIBAEDXLvWr5kHn2X5Y\njQ/M5Rtx1XYctYpk4O7iAywgKtjkcureIgO/HHHIDAMKcc6EeYITmHUS+/8m6y/3\nU4Wk6VKPv2zwTu6HwcraRxyVE9QqQq4IuK+UdqhBTP7haeiFgVImSSqxnpyJmjBd\nNEjginv6jMh1JEfvLJ7Wi+7es9AWxyEkyhQC759z3Xn6cGGi2JPjhpEU/n/1L4So\nSRIm4i9T9+Uc/cPOQqOKLf3ZaGkFrYgwOEfDoAKgTfUUN/in5lPd9C0J+CqhOizy\n8OsBtuWziGYnDJSmm+w0/faSo2zPugGxjMq/Nhq7nRcmTE7odNUMjACgnQznT45M\nqIrq0h0CgYEAwkmgPXVu4a4Nt2cXRVxmZ3GyZ9L/+xAihIzdSnFm/L51VtWqISd5\nKMVtizlf4EFoIOgPg3MpWBQjeKmaT9FBbWampXV1VwmAmKc437loR/ofXwnvGaXM\nqpLoySOIMJS/iGkC5lsF/h1+llk02aomdoK3fTr4bBUhEo945h3zlHcCgYEAyLX1\nf6ZAU2vb9wyKXBb7ZWoFMKWb2cFUz7gkJqFPZcw5LPV7o28R3T1XVjRXf3kSCpVg\npJu0skZKmNLvFdX0ZUg9npAfGsQJf+IoSX/2dfBecX+AH38wzccHO4+jE/dTz086\n05kKfpOCZCjmYLhv7Hd3ubBXTRLJaWIVueCiIxsCgYEAj3pr2bc1kXhGLOD28IQS\nI+Z1B/Nsku4Rb63PZkBk+9VzNhNINn++G/vgr+ZJBYWH7nUxr7OGHsOQhnVJvhQc\nqzwZaSta4lHkI9eqSp3TgwQV0su1RU2J3ZXsT03sL2RKJeTW/WLPBCCn8UQjoXLk\nQLS76MF53+eiquBFOjt4PHUCgYAT7MxkUbLNFUYO7nXF0po+ZRoCzE3+fgzXWiZs\nl1L0fiOm7O/LN7mERxSmgCe3heNenZmsfbCgig3ZwgbuGgFbFKLZXOFZnOB8i40I\nTuW+q5AUoF2twsirhPiY1xePYdw2Fl12qBi8nBQzsUO9klG6HdoK2xCvnA/WoGAb\nxcsSxQKBgQCXk8t0qliPczYbjlfedeSTiw9vnddPJ6tS/v/Gz7qoUCkbFZ79kew7\nvWBQ1wjgQaD7OkoB3Mjmb0/V1JByvnhg4GyKCQHvsZkzkDqdgChVHhDsrWpA1RoP\nWJWscbWXID6zAdEtvIsJCUcQhnrw+uDoK2OnwF+UTazOEgtJlfONbQ==\n-----END PRIVATE KEY-----
```

### Key Format Rules

1. **Must start with:** `-----BEGIN PRIVATE KEY-----\n`
2. **Base64 content:** Each line separated by `\n` (not actual newlines, not spaces)
3. **Must end with:** `\n-----END PRIVATE KEY-----`
4. **No spaces** between base64 chunks
5. **Each base64 line** should be ~64 characters (standard PEM format)

### Visual Comparison

#### ❌ WRONG - What You Currently Have

```
MIIEpAIBAAKCAQEAmFOdj6ZAhzWO8ickWg8TikXOPnBycUesH6GcH3zy0quVJCgE pGsl3Jnj0cW8fL/daMLccl9IC/45DMmpGzsiQF/lP06YtOCcGYxf1IEsfY4k8p/K ...
```

**Problems:**
- No header/footer
- Spaces between chunks (should be `\n`)
- Not properly formatted

#### ✅ CORRECT - How It Should Look in Vercel

```
-----BEGIN PRIVATE KEY-----\nMIIEpAIBAAKCAQEAmFOdj6ZAhzWO8ickWg8TikXOPnBycUesH6GcH3zy0quVJCgE\npGsl3Jnj0cW8fL/daMLccl9IC/45DMmpGzsiQF/lP06YtOCcGYxf1IEsfY4k8p/K\n...base64 content...\n-----END PRIVATE KEY-----
```

**Requirements:**
- Has header and footer
- Uses literal `\n` characters (backslash + n)
- No spaces in the middle
- One continuous string

---

## 3. KALSHI_EMAIL

### Correct Format

```
your.email@example.com
```

### Details
- Your Kalshi account email address
- No special formatting needed

### Example in Vercel
```
Variable Name: KALSHI_EMAIL
Value: your.email@example.com
```

---

## How to Get Your Credentials from Kalshi

1. **Log in** to [Kalshi](https://kalshi.com)
2. Go to **Settings** → **API** → **Developer API**
3. Click **Generate API Key**
4. **Save immediately:**
   - API Key (UUID format)
   - Private Key (download or copy)
5. Copy your account email

### When Downloading Private Key

If you download the `.pem` file from Kalshi, it will look like this:

```
-----BEGIN PRIVATE KEY-----
MIIEpAIBAAKCAQEAmFOdj6ZAhzWO8ickWg8TikXOPnBycUesH6GcH3zy0quVJCgE
pGsl3Jnj0cW8fL/daMLccl9IC/45DMmpGzsiQF/lP06YtOCcGYxf1IEsfY4k8p/K
MOwBnyZONGuq0nN6IN31KYgJdA8AUiS7E0A9V1yXAFILs2zit7CXuIUfSlU1Sb/j
... (more lines)
-----END PRIVATE KEY-----
```

**To use in Vercel environment variable:**
- Replace each **actual newline** with `\n` (backslash + n)
- Make it one continuous string
- Keep the header and footer

---

## Converting from .pem File to Vercel Format

### Method 1: Use the Formatting Script

```bash
# Run the formatting script with your raw key
node scripts/format-kalshi-key.js "PASTE_YOUR_RAW_KEY_HERE"
```

The script will output the properly formatted key.

### Method 2: Manual Conversion

If you have the `.pem` file:

```bash
# On Linux/Mac
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' kalshi-private-key.pem
```

This will output the key with `\n` separators ready for Vercel.

### Method 3: Online Tool

1. Open your `.pem` file in a text editor
2. Copy all content (including header/footer)
3. Use an online "newline to \n converter"
4. Paste the result into Vercel

---

## Verifying Your Format

### Test Locally

Create a test file `.env.local`:

```bash
KALSHI_API_KEY=bf7032cd-0348-4988-9396-a479ad7fdc2a
KALSHI_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEpAIBAA...\n-----END PRIVATE KEY-----"
KALSHI_EMAIL=your.email@example.com
```

Note: Use quotes around the private key in `.env` files.

### Test in Code

The code in `lib/markets/kalshi.ts` automatically handles the `\n` conversion:

```typescript
private formatPrivateKey(key: string): string {
  if (!key) return '';
  
  // Handle escaped newlines (common in .env files)
  if (formattedKey.includes('\\n')) {
    formattedKey = formattedKey.replace(/\\n/g, '\n');
  }
  // ... more formatting logic
}
```

So when you paste `\n` in Vercel, the code converts it to actual newlines.

---

## Updating in Vercel

1. **Go to Vercel Dashboard**
   - Navigate to your project
   - Click **Settings** → **Environment Variables**

2. **Update Each Variable**
   - Click **Edit** next to each variable
   - Paste the correctly formatted value
   - Click **Save**

3. **Redeploy**
   - Go to **Deployments**
   - Click **⋯** (three dots) on the latest deployment
   - Click **Redeploy**
   - Or push a new commit to trigger deployment

---

## Common Errors and Solutions

### Error: "401 Unauthorized"

**Cause:** Private key is incorrectly formatted

**Solution:** 
- Ensure you have `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
- Replace all spaces with `\n`
- Use the formatting script

### Error: "Error signing Kalshi request"

**Cause:** Private key can't be parsed by Node.js crypto

**Solution:**
- Check that base64 content has no spaces
- Verify header/footer spelling
- Make sure you're using `PRIVATE KEY` not `RSA PRIVATE KEY`

### Error: "Invalid key format"

**Cause:** Missing newlines or wrong header type

**Solution:**
- Regenerate the key from Kalshi
- Use the formatting script to ensure proper format
- Double-check you copied the entire key

---

## Security Notes

⚠️ **Never commit these credentials to Git**
- Keep them only in Vercel environment variables
- Use `.env.local` for local development (in `.gitignore`)
- Rotate keys regularly

⚠️ **Key Expiration**
- Kalshi API keys may expire
- Check Kalshi dashboard if authentication suddenly fails
- Regenerate and update in Vercel if needed

---

## Quick Reference

### Checklist for Correct Format

- [ ] `KALSHI_API_KEY`: UUID format (no special formatting)
- [ ] `KALSHI_PRIVATE_KEY`: Has `-----BEGIN PRIVATE KEY-----\n` at start
- [ ] `KALSHI_PRIVATE_KEY`: Has `\n-----END PRIVATE KEY-----` at end
- [ ] `KALSHI_PRIVATE_KEY`: Uses `\n` not spaces or actual newlines
- [ ] `KALSHI_PRIVATE_KEY`: Base64 content has no spaces
- [ ] `KALSHI_EMAIL`: Your Kalshi account email
- [ ] All variables saved in Vercel
- [ ] Redeployed after updating

### Testing After Update

Run a manual cron trigger to test:

```bash
curl -X GET "https://your-app.vercel.app/api/bot/cron?secret=YOUR_CRON_SECRET"
```

Check logs for:
- ✅ No "401 Unauthorized" errors
- ✅ Balance fetched successfully
- ✅ Markets loading

---

## Support

If you continue to have issues after following this guide:

1. **Regenerate credentials** from Kalshi dashboard
2. **Use the formatting script** to ensure correct format
3. **Check Kalshi API documentation**: https://docs.kalshi.com/
4. **Verify API access** is enabled on your Kalshi account


