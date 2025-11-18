# Vercel Build Configuration

This guide explains how to prevent Vercel from triggering builds when only data files change.

## Problem

When the bot starts or updates status, it writes to files in the `data/` directory in your GitHub repository. This triggers git commits, which cause Vercel to rebuild and redeploy your entire application unnecessarily.

## Solution

We've configured Vercel to skip builds when only data files change.

## Setup Instructions

### Step 1: Commit the Changes

The following files have been updated:
- `vercel.json` - Added GitHub optimizations
- `scripts/should-build.sh` - Script to detect data-only changes

Commit and push these changes:

```bash
git add vercel.json scripts/should-build.sh VERCEL_BUILD_CONFIG.md
git commit -m "Configure Vercel to ignore data-only changes"
git push origin main
```

### Step 2: Configure Vercel Project Settings

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your **AlgoBet** project
3. Go to **Settings** → **Git**
4. Scroll down to **Ignored Build Step**
5. Enter this command:
   ```bash
   bash scripts/should-build.sh
   ```
6. Click **Save**

### Step 3: Test

To test if it's working:

1. Start your bot from the dashboard (this writes to `data/bot-status.json`)
2. Check the Vercel dashboard
3. You should see a message like: **"Build skipped due to Ignored Build Step"**

## How It Works

The `should-build.sh` script:
1. Checks what files changed since the last deployment
2. Filters out any files in the `data/` directory
3. If **only** data files changed → Skip build (exit 0)
4. If **any** code files changed → Proceed with build (exit 1)

## What's in vercel.json

```json
"github": {
  "silent": true,              // Reduces GitHub comment noise
  "autoJobCancelation": true   // Cancels redundant builds automatically
}
```

## Troubleshooting

**Builds still triggering?**
- Make sure you configured the Ignored Build Step in Vercel settings
- Check that the script path is correct: `bash scripts/should-build.sh`
- Verify the script has the correct permissions (should be fine on Vercel)

**Need to force a build?**
- Add a comment to any code file (e.g., `README.md`)
- Or manually trigger a deployment from the Vercel dashboard

## Alternative: Separate Data Branch

If you prefer, you can store data in a separate branch that doesn't trigger deployments:

1. Set environment variable in Vercel:
   ```
   GITHUB_DATA_BRANCH=data
   ```

2. Create and push the data branch:
   ```bash
   git checkout -b data
   git push origin data
   git checkout main
   ```

3. Vercel will only deploy commits to `main`, while data writes go to the `data` branch.

This approach requires no Ignored Build Step configuration but needs a separate branch setup.

