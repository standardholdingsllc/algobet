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

Additional Kalshi discovery controls:
- `KALSHI_LIVE_CLOSE_WINDOW_MINUTES` (default: `360`) — only fetch markets closing within the next N minutes.
- `KALSHI_MIN_CLOSE_WINDOW_MINUTES` (default: `120`) — include markets that closed/started recently (lookback).
- `KALSHI_MAX_PAGES_PER_SERIES` (default: `2`) — pagination cap per series ticker to avoid crawling thousands of pages.
- `KALSHI_MAX_TOTAL_MARKETS` (default: `2000`) — hard cap per refresh across all series.
- `KALSHI_SERIES_CACHE_TTL_MS` (default: `3600000`) — cache sports series discovery.
- `KALSHI_SPORTS_SERIES_TICKERS_OVERRIDE` — optional comma-separated fallback list if discovery fails.

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
# Sports series discovery + fetch bounds
KALSHI_LIVE_CLOSE_WINDOW_MINUTES=360
KALSHI_MIN_CLOSE_WINDOW_MINUTES=120
KALSHI_MAX_PAGES_PER_SERIES=2
KALSHI_MAX_TOTAL_MARKETS=2000
KALSHI_SERIES_CACHE_TTL_MS=3600000
# Optional fallback list if discovery fails (comma separated)
KALSHI_SPORTS_SERIES_TICKERS_OVERRIDE=

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
# When empty, SX.bet shows as "disabled" in dashboard (not an error)
SXBET_WS_URL=wss://ably.sx.bet/...

# Worker refresh interval in milliseconds (default: 15000)
# This is how often the worker fetches market data (can be slow)
LIVE_ARB_WORKER_REFRESH_MS=15000

# Idle polling interval when bot is stopped (default: 5000)
LIVE_ARB_IDLE_POLL_MS=5000

# CRITICAL: Heartbeat interval in milliseconds (default: 5000)
# This is DECOUPLED from refresh - heartbeat writes every 5s even if refresh takes minutes
# This ensures workerPresent stays true as long as the worker process is alive
WORKER_HEARTBEAT_INTERVAL_MS=5000

# How long before a heartbeat is considered stale (default: 60000)
# If heartbeat is older than this, workerPresent becomes false
# Should be much larger than WORKER_HEARTBEAT_INTERVAL_MS to allow for temporary failures
WORKER_HEARTBEAT_STALE_MS=60000

# Graceful shutdown timeout in milliseconds (default: 25000)
# Worker will force-exit after this if shutdown takes too long
# MUST be less than pm2 kill_timeout (30000)
WORKER_SHUTDOWN_GRACE_MS=25000

# Delay before final STOPPED write during shutdown (default: 1500)
# This ensures STOPPING state is observable during pm2 restart
WORKER_SHUTDOWN_STOPPING_DELAY_MS=1500

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

### Worker Shows "No Heartbeat" or workerPresent=false

**Symptom**: Dashboard shows "ENABLED (NO HEARTBEAT)" even though worker is running.

**Diagnosis**:
```bash
curl https://your-app.vercel.app/api/live-arb/status | jq '{workerPresent, workerState, workerHeartbeatAt, workerHeartbeatAgeMs}'
```

**Causes & Solutions**:
1. **Worker not running**: Start with `npm run live-arb-worker` or `pm2 restart live-arb-worker`
2. **KV connection issues**: Check Upstash credentials (`KV_REST_API_URL`, `KV_REST_API_TOKEN`)
3. **Heartbeat interval too slow**: Ensure `WORKER_HEARTBEAT_INTERVAL_MS` ≤ 10000
4. **Stale threshold too short**: Ensure `WORKER_HEARTBEAT_STALE_MS` ≥ 60000

### Platforms Show "No Worker" When Worker Is Running

**Symptom**: Kalshi/Polymarket show "no_worker" state but worker is alive.

**Cause**: Heartbeat is stale (workerPresent=false triggers "no_worker" for all non-disabled platforms).

**Solution**: Same as above - ensure heartbeat is writing frequently.

### SX.bet Shows "Disabled"

**Expected behavior** when `SXBET_WS_URL` is not set. This is informational, not an error.

To enable SX.bet: Set `SXBET_WS_URL` to the SX.bet Ably WebSocket endpoint.

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

## PM2 Operations (Production Worker)

The live-arb-worker is designed to run with PM2 for production stability.

### Initial Setup

```bash
# Install PM2 globally
npm install -g pm2

# Start the worker
pm2 start ecosystem.config.js

# Save PM2 process list (survives reboot)
pm2 save

# Set up PM2 to run on startup
pm2 startup
```

### Common Commands

```bash
# View status
pm2 status live-arb-worker

# View logs
pm2 logs live-arb-worker

# Restart (graceful)
pm2 restart live-arb-worker

# Stop
pm2 stop live-arb-worker

# Delete from PM2
pm2 delete live-arb-worker
```

### Log Rotation

Install pm2-logrotate to prevent logs from filling disk:

```bash
# Install logrotate module
pm2 install pm2-logrotate

# Configure rotation settings
pm2 set pm2-logrotate:max_size 50M       # Rotate when log exceeds 50MB
pm2 set pm2-logrotate:retain 7           # Keep 7 rotated logs
pm2 set pm2-logrotate:compress true      # Compress old logs
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:rotateModule true  # Also rotate PM2 module logs
```

### Monitoring

```bash
# Real-time monitoring
pm2 monit

# JSON status output
pm2 jlist

# Check restart count
pm2 show live-arb-worker | grep restarts
```

### Graceful Shutdown Verification

When you run `pm2 restart live-arb-worker`:

1. Worker receives SIGINT/SIGTERM
2. Writes `STOPPING` state to KV immediately
3. Closes WebSocket connections
4. Writes `STOPPED` state to KV
5. Exits cleanly (exit code 0)
6. PM2 starts new instance
7. New instance writes `STARTING` then `RUNNING`/`IDLE`

Check via:
```bash
# Watch status endpoint during restart
watch -n 1 'curl -s https://your-app.vercel.app/api/live-arb/status | jq "{workerState, workerHeartbeatAt, shutdown}"'
```

### Troubleshooting PM2

**Worker keeps restarting:**
```bash
pm2 logs live-arb-worker --lines 100  # Check for crash reasons
```

**Memory issues:**
```bash
pm2 show live-arb-worker  # Check memory usage
# Adjust max_memory_restart in ecosystem.config.js if needed
```

**Config changes not applied:**
```bash
pm2 delete live-arb-worker
pm2 start ecosystem.config.js
```

## Summary

You need these credentials:

1. **Kalshi**: API key, private key, email
2. **Polymarket**: API key, private key, wallet address
3. **GitHub**: Personal access token, username, repo name
4. **Email**: SMTP host, port, credentials, alert email
5. **Auth**: Random secret, username, password hash

Use the verification scripts to confirm everything works before deploying!

