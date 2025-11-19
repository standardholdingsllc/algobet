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
- **NEW**: Tracks scan duration metrics (last & average)
- **NEW**: Monitors watchdog heartbeat

### 2. **Graceful Error Recovery**
- Individual scan failures don't stop the bot
- Errors are logged but the bot continues running
- Automatic retry on next cron cycle (1 minute)

### 3. **Smart Auto-Restart**
- **NEW**: Soft restart after 2 missed scans (doesn't count towards throttle)
- Full restart after 5+ minutes of no scans or 5+ consecutive errors
- **NEW**: Restart throttling (max 3 restarts per 60 minutes)
- **NEW**: Detailed restart reason logging
- Resets error counters on successful restart

### 4. **Watchdog Monitoring**
- Monitors bot health every 5 minutes
- **NEW**: Updates heartbeat timestamp on every run
- **NEW**: Bot marked unhealthy if watchdog inactive for 10+ minutes
- Automatically restarts if unhealthy (with throttle protection)

### 5. **Dashboard Health Display**
- Real-time health status indicator
- Shows last scan time
- Displays error count
- Visual health indicator (green/red)
- **NEW**: Shows average scan duration
- **NEW**: Displays health reasons when unhealthy
- **NEW**: Shows restart throttle status

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
- **Features**:
  - Updates watchdog heartbeat timestamp
  - **Soft Restart**: 2+ missed scans (doesn't count towards throttle)
  - **Full Restart**: 5+ minutes no scans OR 5+ consecutive errors
  - **Restart Throttling**: Max 3 restarts per 60 minutes
  - Detailed restart reason logging
- **Action**: Restarts bot and resets error counters (if not throttled)

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
    "totalErrors": 3,
    "watchdogLastRun": "2025-11-19T06:10:00.000Z",
    "minutesSinceWatchdog": 2,
    "restartAttempts": 0,
    "restartThrottled": false,
    "lastRestartReason": null,
    "lastScanDurationMs": 2340,
    "averageScanDurationMs": 2156,
    "healthReasons": ["All systems operational"]
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
- **NEW**: Watchdog active (ran within 10 minutes)
- **NEW**: Not restart throttled

### Unhealthy ❌
- Bot is running BUT any of these:
  - No scan in 5+ minutes, OR
  - 5+ consecutive errors, OR
  - **NEW**: Watchdog inactive for 10+ minutes, OR
  - **NEW**: Restart throttling active (3 restarts in 60 min)

---

## 🔄 Auto-Restart Flow

### Soft Restart (2 missed scans)
```
1. Watchdog detects 2+ minutes since last scan
   ↓
2. Logs: "[Watchdog] Soft restart: 2 missed scan cycles"
   ↓
3. Disables bot → waits 1 second → re-enables
   ↓
4. Does NOT count towards throttle limit
   ↓
5. Bot resumes scanning on next cron cycle
```

### Full Restart (5+ minutes or 5+ errors)
```
1. Watchdog detects unhealthy state
   ↓
2. Checks restart throttle (max 3 per 60 min)
   ↓
3. If throttled:
   - Log: "[Watchdog] Restart blocked: throttle limit reached"
   - Mark as restartThrottled = true
   - Return without restarting
   ↓
4. If not throttled:
   a. Log restart reason
   b. Increment restart counter
   c. Disables bot → waits 2 seconds → re-enables
   d. Resets error counter
   ↓
5. Bot resumes scanning on next cron cycle
```

---

## 🎨 Dashboard Display

When the bot is running and healthy, you'll see:

```
Dashboard
Monitor your arbitrage trading bot
● Healthy • 142 scans • Last: 0m ago • Avg: 2.1s
```

Or if unhealthy:

```
Dashboard
Monitor your arbitrage trading bot
● Unhealthy • 142 scans • Last: 7m ago • Avg: 2.3s
No scan in 7 minutes • 5 consecutive errors
```

Or if restart throttled:

```
Dashboard
Monitor your arbitrage trading bot
● Unhealthy • 142 scans • Last: 2m ago • Avg: 2.1s
Restart throttling active
⚠️ Restart throttled (3/3 restarts in last hour)
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

---

## 🆕 New Features Summary

### 1. Watchdog Heartbeat
- Tracks when watchdog last ran
- Bot marked unhealthy if watchdog inactive for 10+ minutes
- Prevents silent failures of the monitoring system itself

### 2. Restart Throttling
- Maximum 3 restarts per 60-minute window
- Prevents restart loops from draining resources
- Automatically resets after 60 minutes
- Soft restarts don't count towards limit

### 3. Soft Restart
- Triggered after 2 missed scans (early intervention)
- Faster recovery (1 second wait vs 2 seconds)
- Doesn't count towards throttle limit
- Prevents escalation to full restart

### 4. Restart Reason Logging
- Every restart logs a clear reason
- Exposed in `/api/bot/status` as `lastRestartReason`
- Examples:
  - "Soft restart: 2 missed scan cycles"
  - "Restart triggered: No scan in 7 minutes"
  - "Restart triggered: 6 consecutive errors"
  - "Throttled: Restart triggered: No scan in 8 minutes"

### 5. Scan Duration Metrics
- Tracks duration of each scan in milliseconds
- Calculates weighted moving average (80% old, 20% new)
- Exposed as `lastScanDurationMs` and `averageScanDurationMs`
- Helps identify performance degradation

### 6. Enhanced Health Logic
- Four health criteria (was two):
  1. Scan recency (< 5 minutes)
  2. Error count (< 5 consecutive)
  3. Watchdog heartbeat (< 10 minutes)
  4. Restart throttle status
- Returns `healthReasons` array with specific issues
- More granular health status

---

**Your bot is now production-ready for 24/7 operation with advanced monitoring!** 🚀

