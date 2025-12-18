# Environment Variables Setup Guide

Complete guide to configuring all environment variables for AlgoBet.

## Generate Required Secrets

### 1. NEXTAUTH_SECRET

Generate a random secret:

```bash
openssl rand -base64 32
```

Or use Node.js:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2. ADMIN_PASSWORD_HASH

Generate password hash:

```bash
npm run generate-password YourSecurePassword
```

Save the output hash.

### 3. CRON_SECRET (Optional)

For securing cron endpoint:

```bash
openssl rand -hex 32
```

## Get API Credentials

### Kalshi API

1. Log in to [Kalshi](https://kalshi.com)
2. Navigate to **Settings** → **API**
3. Click **Generate API Key**
4. Save:
   - `KALSHI_API_KEY`
   - `KALSHI_PRIVATE_KEY`
5. Note your account email for `KALSHI_EMAIL`

**Documentation**: https://docs.kalshi.com/getting_started/authentication

### Polymarket API

1. Log in to [Polymarket](https://polymarket.com)
2. Navigate to **Settings** → **Developer**
3. Click **Create API Key**
4. Save:
   - `POLYMARKET_API_KEY`
   - `POLYMARKET_PRIVATE_KEY`
5. Copy your wallet address for `POLYMARKET_WALLET_ADDRESS`

**Documentation**: https://docs.polymarket.com/

## GitHub Personal Access Token

1. Go to [GitHub Settings](https://github.com/settings/tokens)
2. Click **Personal access tokens** → **Tokens (classic)**
3. Click **Generate new token (classic)**
4. Configure:
   - **Note**: `AlgoBet Storage`
   - **Expiration**: 90 days (or longer)
   - **Scopes**: Select `repo` (Full control of private repositories)
5. Click **Generate token**
6. **Copy token immediately** (shown only once)

Save as `GITHUB_TOKEN`.

## Email Configuration

### Gmail Setup

1. Enable 2-Factor Authentication:
   - [Google Account](https://myaccount.google.com/) → Security → 2-Step Verification

2. Create App Password:
   - Go to [App Passwords](https://myaccount.google.com/apppasswords)
   - Select **Mail** and **Other (Custom name)**
   - Name: `AlgoBet`
   - Copy the 16-character password

3. Configure:
   ```
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=your@gmail.com
   EMAIL_PASS=xxxx xxxx xxxx xxxx (app password)
   ```

### Outlook/Hotmail Setup

```
EMAIL_HOST=smtp-mail.outlook.com
EMAIL_PORT=587
EMAIL_USER=your@outlook.com
EMAIL_PASS=your-password
```

### Yahoo Setup

```
EMAIL_HOST=smtp.mail.yahoo.com
EMAIL_PORT=587
EMAIL_USER=your@yahoo.com
EMAIL_PASS=your-app-password
```

### Custom SMTP

Use your hosting provider's SMTP settings:

```
EMAIL_HOST=mail.yourdomain.com
EMAIL_PORT=587  # or 465 for SSL
EMAIL_USER=noreply@yourdomain.com
EMAIL_PASS=your-password
```

## Complete .env File

Create `.env` in project root:

```env
# ===================================
# AUTHENTICATION
# ===================================
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000  # Change to your Vercel URL in production
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<from generate-password-hash.js>

# ===================================
# KALSHI API
# ===================================
KALSHI_API_KEY=your-kalshi-api-key
KALSHI_PRIVATE_KEY=your-kalshi-private-key
KALSHI_EMAIL=your-kalshi-account@email.com

# ===================================
# POLYMARKET API
# ===================================
POLYMARKET_API_KEY=your-polymarket-api-key
POLYMARKET_PRIVATE_KEY=your-polymarket-private-key
POLYMARKET_WALLET_ADDRESS=0x1234567890abcdef...

# ===================================
# GITHUB STORAGE
# ===================================
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=your-github-username
GITHUB_REPO=AlgoBet

# ===================================
# EMAIL ALERTS
# ===================================
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx
ALERT_EMAIL=alerts@email.com

# ===================================
# BOT CONFIGURATION (Optional - can be set in dashboard)
# ===================================
MAX_BET_PERCENTAGE=4
MAX_DAYS_TO_EXPIRY=5
MIN_PROFIT_MARGIN=0.5

# ===================================
# CRON (Optional - for securing cron endpoint)
# ===================================
CRON_SECRET=<openssl rand -hex 32>

# ===================================
# LIVE ARB WORKER (Optional - for live betting)
# ===================================
# SX.bet WebSocket URL (leave empty to disable SX.bet WS)
SXBET_WS_URL=wss://ably.sx.bet/...

# Worker refresh interval in milliseconds (default: 15000)
LIVE_ARB_WORKER_REFRESH_MS=15000

# Idle polling interval when bot is stopped (default: 5000)
LIVE_ARB_IDLE_POLL_MS=5000

# How long before a heartbeat is considered stale (default: 60000)
WORKER_HEARTBEAT_STALE_MS=60000

# Minimum profit in basis points (default: 50)
LIVE_ARB_MIN_PROFIT_BPS=50

# Max price age in milliseconds (default: 2000)
LIVE_ARB_MAX_PRICE_AGE_MS=2000

# Log level: 'info' or 'debug' (default: info)
LIVE_ARB_LOG_LEVEL=info
```

## Vercel Environment Variables

When deploying to Vercel, add all variables:

### Via CLI

```bash
vercel env add NEXTAUTH_SECRET production
vercel env add NEXTAUTH_URL production
vercel env add ADMIN_USERNAME production
vercel env add ADMIN_PASSWORD_HASH production
vercel env add KALSHI_API_KEY production
vercel env add KALSHI_PRIVATE_KEY production
vercel env add KALSHI_EMAIL production
vercel env add POLYMARKET_API_KEY production
vercel env add POLYMARKET_PRIVATE_KEY production
vercel env add POLYMARKET_WALLET_ADDRESS production
vercel env add GITHUB_TOKEN production
vercel env add GITHUB_OWNER production
vercel env add GITHUB_REPO production
vercel env add EMAIL_HOST production
vercel env add EMAIL_PORT production
vercel env add EMAIL_USER production
vercel env add EMAIL_PASS production
vercel env add ALERT_EMAIL production
vercel env add CRON_SECRET production
```

### Via Dashboard

1. Go to your Vercel project
2. **Settings** → **Environment Variables**
3. Add each variable:
   - **Key**: Variable name (e.g., `NEXTAUTH_SECRET`)
   - **Value**: Variable value
   - **Environment**: Select all (Production, Preview, Development)
4. Click **Add**
5. Repeat for all variables

## Verification

### Check All Variables Set

```bash
npm run check-env
```

Should output:
```
✅ NEXTAUTH_SECRET
✅ NEXTAUTH_URL
✅ ADMIN_USERNAME
... (all variables)
✅ All required environment variables are set!
```

### Test API Connections

```bash
npm run test-apis
```

Should output:
```
✅ Kalshi API is accessible
✅ Polymarket API is accessible
✅ GitHub API is accessible
✅ All APIs are working correctly!
```

## Security Best Practices

### Do Not
- ❌ Commit `.env` file to git
- ❌ Share API keys publicly
- ❌ Use production keys in development
- ❌ Store credentials in code

### Do
- ✅ Use `.env.local` for local overrides
- ✅ Rotate API keys quarterly
- ✅ Use different keys for dev/prod
- ✅ Keep `.env` in `.gitignore`
- ✅ Use strong passwords
- ✅ Enable 2FA on all accounts

## Troubleshooting

### Variable Not Found

**Error**: `Cannot find VARIABLE_NAME`

**Solution**: 
1. Check `.env` file exists in project root
2. Verify variable name matches exactly
3. Restart development server: `npm run dev`

### Authentication Failed

**Error**: API authentication errors

**Solution**:
1. Verify API keys are copied correctly (no extra spaces)
2. Check keys haven't expired
3. Ensure keys have correct permissions
4. Test: `npm run test-apis`

### Email Not Sending

**Error**: Email alerts not received

**Solution**:
1. Verify SMTP settings match your provider
2. For Gmail, ensure App Password is used
3. Check firewall isn't blocking port 587
4. Try different email provider

### GitHub Storage Failed

**Error**: Cannot save to GitHub

**Solution**:
1. Verify token has `repo` scope
2. Check `GITHUB_OWNER` matches your username exactly
3. Ensure `GITHUB_REPO` matches repository name
4. Confirm `storage.json` exists in repo

## Environment-Specific Configs

### Development (.env.local)

```env
NEXTAUTH_URL=http://localhost:3000
# Use test API keys if available
KALSHI_API_KEY=test-key
POLYMARKET_API_KEY=test-key
```

### Production (Vercel)

```env
NEXTAUTH_URL=https://your-app.vercel.app
# Use production API keys
# Set via Vercel dashboard or CLI
```

### Staging (Optional)

```env
NEXTAUTH_URL=https://staging.your-app.vercel.app
# Use staging API keys
```

## Updating Variables

### Local Development

1. Edit `.env` file
2. Restart server: `npm run dev`

### Vercel Production

```bash
# Update single variable
vercel env rm VARIABLE_NAME production
vercel env add VARIABLE_NAME production

# Or use dashboard: Settings → Environment Variables
```

After updating, redeploy:
```bash
vercel --prod
```

## Backup & Recovery

### Backup Environment

```bash
# Save to secure location (NOT git)
cp .env .env.backup.$(date +%Y%m%d)
```

### Recovery

```bash
# Restore from backup
cp .env.backup.20250123 .env
```

## Checklist

Before running the app:

- [ ] All required variables set
- [ ] API keys valid and active
- [ ] GitHub token has repo access
- [ ] Email credentials work
- [ ] `npm run check-env` passes
- [ ] `npm run test-apis` passes
- [ ] `.env` in `.gitignore`
- [ ] Backup of `.env` saved securely

## Need Help?

- Check variable names match exactly (case-sensitive)
- Review error messages carefully
- Test each service independently
- Consult service documentation
- Open GitHub issue with details (never share actual keys!)

## Summary

You need these credentials:

1. **Kalshi**: API key, private key, email
2. **Polymarket**: API key, private key, wallet address
3. **GitHub**: Personal access token, username, repo name
4. **Email**: SMTP host, port, credentials, alert email
5. **Auth**: Random secret, username, password hash

Use the verification scripts to confirm everything works before deploying!

