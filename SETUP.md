# AlgoBet Setup Guide

This guide will walk you through setting up your AlgoBet arbitrage trading bot from scratch.

## Prerequisites

- Node.js 18+ installed
- GitHub account
- Kalshi account with API access
- Polymarket account with API access
- Email account for alerts (Gmail recommended)

## Step-by-Step Setup

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd AlgoBet
npm install
```

### 2. Set Up GitHub Storage

1. Create a new GitHub repository (can be private)
2. Initialize it with the `data/storage.json` file:

```bash
git init
git add data/storage.json
git commit -m "Initialize data storage"
git remote add origin https://github.com/YOUR_USERNAME/AlgoBet.git
git push -u origin main
```

3. Create a Personal Access Token:
   - Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Click "Generate new token (classic)"
   - Give it a name like "AlgoBet Storage"
   - Select scope: `repo` (Full control of private repositories)
   - Click "Generate token"
   - **Copy the token immediately** (you won't see it again)

### 3. Get Kalshi API Credentials

1. Log in to [Kalshi](https://kalshi.com)
2. Go to Settings → API
3. Generate API key and private key
4. Save these securely

**Documentation**: https://docs.kalshi.com/

### 4. Get Polymarket API Credentials

1. Log in to [Polymarket](https://polymarket.com)
2. Go to Settings → API
3. Generate API credentials
4. Note your wallet address

**Documentation**: https://docs.polymarket.com/

### 5. Configure Email for Alerts

#### Using Gmail

1. Enable 2-factor authentication on your Google account
2. Generate an App Password:
   - Go to Google Account → Security → 2-Step Verification → App passwords
   - Select "Mail" and "Other (Custom name)"
   - Name it "AlgoBet"
   - Copy the 16-character password

#### Using Other Email Providers

Update the SMTP settings in your `.env` file:
- **Gmail**: `smtp.gmail.com:587`
- **Outlook**: `smtp-mail.outlook.com:587`
- **Yahoo**: `smtp.mail.yahoo.com:587`

### 6. Create Environment File

```bash
cp .env.example .env
```

### 7. Generate Admin Password

```bash
node scripts/generate-password-hash.js your_secure_password
```

Copy the output hash.

### 8. Fill in Environment Variables

Edit `.env` and add all credentials:

```env
# Authentication
NEXTAUTH_SECRET=<run: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<from step 7>

# Kalshi API
KALSHI_API_KEY=<your-kalshi-api-key>
KALSHI_PRIVATE_KEY=<your-kalshi-private-key>
KALSHI_EMAIL=<your-kalshi-email>

# Polymarket API
POLYMARKET_API_KEY=<your-polymarket-api-key>
POLYMARKET_PRIVATE_KEY=<your-polymarket-private-key>
POLYMARKET_WALLET_ADDRESS=<your-wallet-address>

# GitHub Storage
GITHUB_TOKEN=<from step 2>
GITHUB_OWNER=<your-github-username>
GITHUB_REPO=AlgoBet

# Email Alerts
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=<your-email>
EMAIL_PASS=<app-password-from-step-5>
ALERT_EMAIL=<where-to-send-alerts>

# Bot Configuration
MAX_BET_PERCENTAGE=4
MAX_DAYS_TO_EXPIRY=5
MIN_PROFIT_MARGIN=0.5
```

### 9. Test Locally

```bash
npm run dev
```

Visit `http://localhost:3000` and log in with your admin credentials.

### 10. Deploy to Vercel

```bash
npm install -g vercel
vercel login
vercel
```

Follow the prompts:
- Set up and deploy? **Y**
- Which scope? *Select your account*
- Link to existing project? **N**
- Project name? **algobet** (or your choice)
- Directory? **./** 
- Override settings? **N**

### 11. Add Environment Variables to Vercel

After deployment, add all environment variables:

```bash
vercel env add NEXTAUTH_SECRET
vercel env add NEXTAUTH_URL
vercel env add ADMIN_USERNAME
vercel env add ADMIN_PASSWORD_HASH
# ... add all other variables
```

Or use the Vercel dashboard:
1. Go to your project on Vercel
2. Settings → Environment Variables
3. Add each variable from your `.env` file
4. Make sure to set for **Production**, **Preview**, and **Development**

### 12. Update NEXTAUTH_URL

After deployment, update the `NEXTAUTH_URL` in Vercel:

```bash
vercel env add NEXTAUTH_URL
# Enter: https://your-project.vercel.app
```

Then redeploy:

```bash
vercel --prod
```

## Verification Checklist

- [ ] Can access dashboard at your Vercel URL
- [ ] Can log in with admin credentials
- [ ] Dashboard shows "Bot Stopped" status
- [ ] Can see empty stats and tables
- [ ] Can update configuration
- [ ] Configuration changes persist (check GitHub repo)
- [ ] Can start the bot
- [ ] Bot status changes to "Running"
- [ ] Check Vercel logs for any errors

## Testing the Bot

### 1. Set Conservative Parameters

In the dashboard, configure:
- **Max Bet Percentage**: 1% (very conservative for testing)
- **Max Days to Expiry**: 2 (focus on short-term markets)
- **Min Profit Margin**: 2% (higher threshold for testing)
- **Balance Thresholds**: Set to 50% of your actual balance

### 2. Start the Bot

Click "Start Bot" in the dashboard.

### 3. Monitor Activity

- Check the dashboard every few minutes
- Watch Vercel logs: `vercel logs --follow`
- Check your email for alerts
- Monitor your Kalshi and Polymarket accounts

### 4. First Arbitrage Bet

When the bot finds and places its first arbitrage:
- You'll see it in the "Recent Bets" table
- Check that both bets were placed
- Verify amounts are correct
- Confirm fees were calculated properly

## Troubleshooting

### Bot Not Finding Opportunities

**Issue**: Dashboard shows bot running but no bets placed.

**Solutions**:
- Lower `MIN_PROFIT_MARGIN` to 0.1%
- Increase `MAX_DAYS_TO_EXPIRY` to 7 days
- Check that both APIs are working (test in their playgrounds)
- Verify there are overlapping markets on both platforms

### Authentication Errors

**Issue**: Can't log in or keeps logging out.

**Solutions**:
- Verify `NEXTAUTH_SECRET` is set
- Check `NEXTAUTH_URL` matches your deployment URL
- Regenerate password hash: `node scripts/generate-password-hash.js newpassword`
- Clear browser cookies and try again

### GitHub Storage Errors

**Issue**: Configuration doesn't save or bets aren't recorded.

**Solutions**:
- Verify GitHub token has `repo` scope
- Check that `data/storage.json` exists in the repository
- Ensure `GITHUB_OWNER` and `GITHUB_REPO` are correct
- Test token: `curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user`

### API Errors

**Issue**: Bot logs show API errors from Kalshi or Polymarket.

**Solutions**:
- Verify API keys are active and not expired
- Check that accounts have trading permissions (not just read-only)
- Ensure accounts have sufficient balance
- Review API documentation for rate limits
- Test APIs independently before running bot

### Email Alerts Not Working

**Issue**: No email alerts received.

**Solutions**:
- Verify SMTP settings are correct
- For Gmail, ensure App Password is used (not account password)
- Check spam folder
- Test with a simple email script
- Try a different email provider

## Production Recommendations

### Before Going Live

1. **Test Thoroughly**: Run bot in test mode for at least a week
2. **Start Small**: Use small balances initially (e.g., $100 per platform)
3. **Monitor Closely**: Check dashboard multiple times daily
4. **Set Conservative Limits**: Use 2-3% max bet percentage initially
5. **Enable All Alerts**: Turn on email alerts for everything

### Security Best Practices

1. **Use Strong Password**: For admin account
2. **Rotate API Keys**: Change keys every 3 months
3. **Private Repository**: Keep GitHub repo private
4. **Secure Environment**: Never commit `.env` file
5. **2FA**: Enable on all accounts (GitHub, Kalshi, Polymarket)

### Monitoring

1. **Daily Checks**: Review dashboard every morning
2. **Weekly Reviews**: Analyze performance weekly
3. **Balance Management**: Rebalance accounts weekly
4. **Data Backups**: Export data monthly

### Risk Management

1. **Start Conservative**: 1-2% bet sizes
2. **Gradual Increases**: Increase limits slowly based on performance
3. **Stop Loss**: If losing money for 3+ days, investigate
4. **Balance Limits**: Never risk more than you can afford to lose

## Getting Help

- **GitHub Issues**: Open an issue for bugs or feature requests
- **Documentation**: Review README.md for detailed information
- **API Docs**: 
  - Kalshi: https://docs.kalshi.com/
  - Polymarket: https://docs.polymarket.com/

## Next Steps

1. Monitor your first week of trading closely
2. Adjust parameters based on results
3. Consider adding more prediction market integrations
4. Set up automated daily reports
5. Optimize bet sizing algorithms

Good luck with your arbitrage trading! 🚀

