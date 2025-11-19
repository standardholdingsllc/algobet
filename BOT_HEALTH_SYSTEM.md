# Bot Health Monitoring & Auto-Restart System

## Overview

Your AlgoBet bot now has a **bulletproof health monitoring and auto-restart system** that ensures it runs 24/7 without manual intervention. The bot will automatically recover from errors and restart if it stops working.

---

## 🎯 Key Features

### 1. **Health Tracking**
- Tracks every scan (success/failure)
- Monitors time since last scan
- Counts consecutive errors
- Stores total scans and error statistics

### 2. **Graceful Error Recovery**
- Individual scan failures don't stop the bot
- Errors are logged but the bot continues running
- Automatic retry on next cron cycle (1 minute)

### 3. **Auto-Restart**
- Watchdog monitors bot health every 5 minutes
- Automatically restarts if unhealthy
- Resets error counters on successful restart

### 4. **Dashboard Health Display**
- Real-time health status indicator
- Shows last scan time
- Displays error count
- Visual health indicator (green/red)

---

## 🏗️ Architecture

### Components

#### 1. **Main Cron Job** (`/api/bot/cron`)
- **Schedule**: Every 1 minute (`* * * * *`)
- **Purpose**: Performs market scans
- **Features**:
  - Graceful error handling
  - Updates health metrics after each scan
  - Returns 200 even on errors (prevents cron from stopping)

#### 2. **Watchdog Cron** (`/api/bot/watchdog`)
- **Schedule**: Every 5 minutes (`*/5 * * * *`)
- **Purpose**: Monitors bot health and auto-restarts
- **Triggers**:
  - No scan in 5+ minutes (when it should run every minute)
  - 5+ consecutive errors
- **Action**: Restarts bot and resets error counters

#### 3. **Health Status API** (`/api/bot/status`)
- **Purpose**: Provides detailed health metrics
- **Returns**:
  ```json
  {
    "healthy": true,
    "running": true,
    "lastScan": "2025-11-19T06:12:40.730Z",
    "lastSuccessfulScan": "2025-11-19T06:12:40.730Z",
    "minutesSinceLastScan": 0,
    "consecutiveErrors": 0,
    "totalScans": 142,
    "totalErrors": 3
  }
  ```

#### 4. **Manual Health Check** (`/api/bot/health`)
- **Purpose**: Manual health check with optional auto-restart
- **Usage**: `GET /api/bot/health?autoRestart=true`
- **Use Case**: External monitoring services (e.g., UptimeRobot)

---

## 📊 Health Criteria

### Healthy ✅
- Bot is running
- Last scan within 5 minutes
- Less than 5 consecutive errors

### Unhealthy ❌
- Bot is running BUT:
  - No scan in 5+ minutes, OR
  - 5+ consecutive errors

---

## 🔄 Auto-Restart Flow

```
1. Watchdog runs every 5 minutes
   ↓
2. Checks bot health
   ↓
3. If unhealthy:
   a. Logs the issue
   b. Disables bot (setBotStatus(false))
   c. Waits 2 seconds
   d. Re-enables bot (setBotStatus(true))
   e. Resets error counter
   ↓
4. Bot resumes scanning on next cron cycle
```

---

## 🎨 Dashboard Display

When the bot is running, you'll see:

```
Dashboard
Monitor your arbitrage trading bot
● Healthy • 142 scans • Last scan: 0m ago
```

Or if unhealthy:

```
Dashboard
Monitor your arbitrage trading bot
● Unhealthy • 142 scans • Last scan: 7m ago • 5 errors
```

---

## 🛠️ Configuration

### Vercel Cron Jobs

Your `vercel.json` now includes two cron jobs:

```json
{
  "crons": [
    {
      "path": "/api/bot/cron",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/bot/watchdog",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

### Environment Variables

Required:
- `CRON_SECRET`: Secret for authenticating cron requests

---

## 🔍 Monitoring

### Check Health Status

```bash
curl https://algobet.vercel.app/api/bot/status
```

### Manual Health Check with Auto-Restart

```bash
curl https://algobet.vercel.app/api/bot/health?autoRestart=true
```

### View Logs

Check Vercel logs for:
- `[Watchdog]` - Watchdog activity
- `Cron scan starting...` - Scan start
- `Cron scan completed` - Scan success
- `Scan error (will retry next cycle)` - Scan failure

---

## 🚀 How It Works (24/7 Operation)

### Normal Operation
```
Minute 0: Scan ✅ → Update health (success)
Minute 1: Scan ✅ → Update health (success)
Minute 2: Scan ✅ → Update health (success)
...
Minute 5: Watchdog checks → Healthy ✅ → No action
...
```

### Error Recovery
```
Minute 0: Scan ✅
Minute 1: Scan ❌ (API timeout) → Update health (error count: 1)
Minute 2: Scan ✅ → Update health (reset error count to 0)
Minute 3: Scan ✅
...
```

### Auto-Restart Scenario
```
Minute 0: Scan ❌ (error count: 1)
Minute 1: Scan ❌ (error count: 2)
Minute 2: Scan ❌ (error count: 3)
Minute 3: Scan ❌ (error count: 4)
Minute 4: Scan ❌ (error count: 5)
Minute 5: Watchdog checks → Unhealthy ❌ → Auto-restart 🔄
Minute 6: Scan ✅ (error count reset to 0)
...
```

---

## 📈 Benefits

1. **Zero Downtime**: Bot runs continuously without manual intervention
2. **Self-Healing**: Automatically recovers from transient errors
3. **Visibility**: Real-time health status on dashboard
4. **Reliability**: Watchdog ensures bot never gets stuck
5. **Monitoring**: Detailed metrics for debugging

---

## 🎯 Result

Your bot will now run **24/7 for weeks** without needing manual restarts. Even if:
- APIs temporarily fail
- Network issues occur
- Individual scans error out
- Vercel has brief outages

The bot will **automatically recover and continue running**! 🚀

