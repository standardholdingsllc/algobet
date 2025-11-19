# Post-Deployment Testing Guide

After deploying the API fixes, follow these steps to verify everything works correctly.

## Quick Verification (2 minutes)

### 1. Check Logs Immediately After Deployment

Go to your Vercel dashboard and check the logs for the cron function:

```
https://vercel.com/[your-project]/logs
```

**Look for these success indicators:**

```
✅ [Polymarket] Fetching markets from Gamma API...
✅ [Polymarket] API Response: X markets received
✅ [Polymarket] Processed X markets:
     - Added: Y
     - Skipped (expired/future): Z
     
✅ [sx.bet] Retrieved N fixtures
   OR
⚠️ [sx.bet] Fixtures endpoint not available (404), continuing without fixture data

✅ Found X Kalshi, Y Polymarket, and Z sx.bet markets
```

**Bad signs (contact me if you see these):**

```
❌ [Polymarket] API Response: 0 markets received
❌ Error fetching Polymarket markets: [unexpected error]
❌ Error fetching sx.bet markets: [unexpected error]
```

### 2. Check Dashboard

Visit your dashboard at:
```
https://your-app.vercel.app/dashboard
```

Verify:
- [ ] Market counts are non-zero for Polymarket
- [ ] No critical error messages in UI
- [ ] Bot status shows as healthy
- [ ] Recent opportunities are being logged

## Detailed Testing (15 minutes)

### Test 1: Polymarket API

```bash
# In your local terminal
curl -s https://gamma-api.polymarket.com/markets?closed=false&limit=10 | jq '.[] | {question: .question, tokens: .tokens}'
```

**Expected:** JSON response with market data

**If it fails:** Polymarket API may be down. Check https://status.polymarket.com

### Test 2: SX.bet API

```bash
# Test markets endpoint
curl -s -H "X-Api-Key: YOUR_SXBET_API_KEY" https://api.sx.bet/markets/active?baseToken=0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B | jq '.data | length'

# Test fixtures endpoint (expected to fail)
curl -s -H "X-Api-Key: YOUR_SXBET_API_KEY" https://api.sx.bet/fixtures
```

**Expected:** 
- Markets endpoint: Returns number > 0
- Fixtures endpoint: 404 error (this is fine - we handle it now)

### Test 3: Trigger Manual Scan

Visit your cron endpoint (replace with your actual URL):

```bash
curl -X POST https://your-app.vercel.app/api/bot/cron?secret=YOUR_CRON_SECRET
```

**Expected Response:**
```json
{
  "message": "Scan completed successfully",
  "running": true,
  "timestamp": "2025-11-19T..."
}
```

Then check logs in Vercel dashboard within 30 seconds.

### Test 4: Check Opportunity Logs

In your dashboard, navigate to the Opportunities tab and verify:

- [ ] New opportunities are being logged
- [ ] They include Polymarket markets
- [ ] Platform combinations are diverse (not just Kalshi vs Kalshi)

## Monitoring Checklist (Daily for first week)

### Day 1 (Today)
- [ ] Verify initial deployment logs show markets
- [ ] Check dashboard shows non-zero markets
- [ ] Monitor for any new errors in logs
- [ ] Verify cron is running every minute

### Day 2-7
Check once daily:
- [ ] Market counts remain stable
- [ ] No accumulating errors
- [ ] Opportunities are being found
- [ ] Balance checks working

## Expected Market Counts

Based on typical availability:

| Platform    | Expected Markets | Typical Range |
|-------------|------------------|---------------|
| Kalshi      | 150-300         | Markets across various categories |
| Polymarket  | 50-200          | Depends on active events |
| SX.bet      | 0-100           | Sports markets only, depends on season |

**Note:** SX.bet may return 0 markets if:
- No sports games scheduled soon
- API key not configured
- Fixtures endpoint unavailable

This is normal and the code handles it gracefully.

## Troubleshooting

### Issue: Polymarket Still Returns 0 Markets

**Check:**
1. View detailed logs - what does the "Processed N markets" section show?
2. Are markets being skipped? Why?

**Common causes:**
- All markets expired (skipped expired/future)
- All markets non-binary (skipped non-binary)
- API response format changed

**Solution:**
Look at the sample market structure in logs and compare to code expectations.

### Issue: SX.bet Returns 0 Markets

**Check:**
1. Is API key configured in Vercel env vars?
2. Do logs show fixtures warning?
3. Are any markets being processed?

**Common causes:**
- No sports games scheduled in the timeframe
- API key invalid
- /markets/active endpoint also failing

**Solution:**
- Verify SXBET_API_KEY is set
- Check sx.bet website for active markets
- May be normal if no sports events

### Issue: Bot Times Out

**Symptoms:**
- Vercel function timeout errors
- Incomplete scans
- Missing log entries

**Solution:**
1. Reduce market limit in Polymarket call (200 → 100)
2. Remove orderbook fetching (use token prices only)
3. Increase function timeout in vercel.json

### Issue: High Error Rate

**If you see frequent errors:**

1. **Check API status pages:**
   - Polymarket: https://status.polymarket.com
   - SX.bet: https://discord.gg/sxbet (ask in #support)

2. **Verify credentials:**
   ```bash
   vercel env ls
   ```
   Ensure all API keys are set

3. **Check rate limits:**
   - May need to add delays between requests
   - Reduce concurrent requests

## Performance Metrics

After 24 hours, you should see:

### Market Fetching
- **Success rate:** >95%
- **Average markets per scan:**
  - Kalshi: 150-300
  - Polymarket: 50-200
  - SX.bet: 0-100 (variable)

### Opportunities
- **Found per day:** Depends on market conditions
- **False positives:** <10%
- **Execution rate:** Depends on confidence threshold

### Health
- **Scan duration:** <10 seconds
- **Error count:** <5%
- **Uptime:** >99%

## Success Criteria

✅ **Deployment is successful if:**

1. Polymarket returns >0 markets consistently
2. SX.bet either returns markets OR logs graceful warning
3. No complete failures (only partial/graceful)
4. Bot continues running without crashes
5. Opportunities are being discovered

❌ **Deployment failed if:**

1. Both Polymarket AND SX.bet return 0 markets
2. Bot crashes or stops running
3. Constant timeout errors
4. No opportunities ever found

## Rollback Procedure

If things aren't working:

### Quick Rollback
```bash
# In your terminal
git log --oneline -5  # Find previous commit
git revert HEAD       # Revert latest changes
git push             # Deploy previous version
```

### Emergency Disable
If you need to temporarily disable a platform:

Go to Vercel → Environment Variables → Add:
```
DISABLE_POLYMARKET=true
DISABLE_SXBET=true
```

Then redeploy.

## Getting Help

### Self-Diagnosis
1. Read the logs carefully
2. Check API status pages
3. Verify environment variables
4. Review this test guide

### If You Need Support

Provide:
1. **Logs:** Last 50 lines from Vercel
2. **Market counts:** What numbers are you seeing?
3. **Error messages:** Full error text
4. **Configuration:** Platform (Vercel), Node version, dependencies
5. **Timeline:** When did it start failing?

### Useful Commands

```bash
# View Vercel logs
vercel logs [deployment-url]

# Check environment variables
vercel env ls

# Force redeploy
vercel --prod

# View recent deployments
vercel ls
```

## Next Steps After Successful Deployment

1. **Monitor for 48 hours** - Ensure stability
2. **Optimize if needed** - Reduce API calls, improve caching
3. **Add metrics** - Track market counts over time
4. **Fine-tune** - Adjust timeouts, limits, thresholds
5. **Document** - Note any patterns or issues

---

**Remember:** Some variation in market counts is normal. Focus on trends over time, not single scans.

**Questions?** Review the API_FIXES_SUMMARY.md for technical details.

