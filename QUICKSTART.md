# AlgoBet Quick Start Guide

Get your arbitrage bot running in under 30 minutes!

## What You'll Need (5 minutes)

- [ ] Kalshi account with API access ([Sign up](https://kalshi.com))
- [ ] Polymarket account with API access ([Sign up](https://polymarket.com))
- [ ] GitHub account ([Sign up](https://github.com))
- [ ] Gmail or other email account for alerts
- [ ] Node.js 18+ installed ([Download](https://nodejs.org))

## Quick Setup (15 minutes)

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd AlgoBet
npm install
```

### 2. Generate Password

```bash
npm run generate-password YourSecurePassword123
```

Copy the hash that's printed.

### 3. Configure Environment

Create `.env` file:

```bash
# Quick .env setup - replace values with your own
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXTAUTH_URL=http://localhost:3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<hash-from-step-2>

# Get these from Kalshi dashboard
KALSHI_API_KEY=your-key
KALSHI_PRIVATE_KEY=your-private-key
KALSHI_EMAIL=your@email.com

# Get these from Polymarket
POLYMARKET_API_KEY=your-key
POLYMARKET_PRIVATE_KEY=your-private-key
POLYMARKET_WALLET_ADDRESS=0x...

# GitHub setup (next step)
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=your-username
GITHUB_REPO=AlgoBet

# Email (use Gmail App Password)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your@gmail.com
EMAIL_PASS=your-app-password
ALERT_EMAIL=alerts@email.com
```

### 4. Initialize GitHub Storage

```bash
bash scripts/init-storage.sh
```

Then:
1. Create new GitHub repo named `AlgoBet`
2. Create [Personal Access Token](https://github.com/settings/tokens) with `repo` scope
3. Add token to `.env` as `GITHUB_TOKEN`
4. Push: 
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/AlgoBet.git
   git push -u origin main
   ```

### 5. Test Everything

```bash
npm run check-env    # Verify all variables are set
npm run test-apis    # Test API connections
```

### 6. Run Locally

```bash
npm run dev
```

Visit `http://localhost:3000` and log in!

## First Run (5 minutes)

### 1. Access Dashboard

Open `http://localhost:3000` and log in with your admin credentials.

### 2. Configure Bot

In the dashboard:
- **Max Bet Percentage**: Start with 1% (conservative)
- **Max Days to Expiry**: 3 days
- **Min Profit Margin**: 1%
- **Balance Thresholds**: Set to 50% of your actual balances

Click "Update Configuration"

### 3. Start Bot

Click the green "▶ Start Bot" button.

### 4. Monitor

Watch the dashboard for:
- Bot status changes to "🟢 Running"
- Account balances update
- Arbitrage opportunities appear
- Bets get placed

## Deploy to Vercel (5 minutes)

### Quick Deploy

```bash
npm install -g vercel
vercel login
vercel
```

### Add Environment Variables

Either use the Vercel dashboard or CLI:

```bash
# Copy all variables from .env to Vercel
vercel env add NEXTAUTH_SECRET
vercel env add NEXTAUTH_URL  # Use your vercel URL!
# ... add all other variables
```

### Deploy Production

```bash
vercel --prod
```

Your bot is now live 24/7! 🚀

## Understanding the Dashboard

### Overview Section
- **Total Profit**: All-time earnings
- **Active Bets**: Currently open positions
- **Account Balances**: Real-time balance from each platform

### Bot Controls
- **Start Bot**: Begin scanning for arbitrage
- **Stop Bot**: Pause all scanning (open bets remain)
- **Status Indicator**: Shows if bot is running

### Profit Chart
- **Blue Line**: Cumulative profit over time
- **Green Line**: Daily profit

### Export Data
- Select period (daily/weekly/monthly/yearly)
- Choose format (CSV/JSON)
- Click "Export" to download

### Recent Bets Table
- See all bets with details
- Track status (pending/filled/resolved)
- View profit/loss

## How It Works

### Arbitrage Example

**Scenario**: NBA game - Knicks vs Lakers

**Kalshi**:
- Knicks to win: 72¢ (0.7% fee = 72.5¢ total)

**Polymarket**:
- Knicks to lose: 27¢ (2% fee = 27.5¢ total)

**Total Cost**: 72.5¢ + 27.5¢ = 100¢ = **$1.00** (Break even, no arbitrage)

**But if**:
- Knicks to win: 70¢ (70.49¢ with fee)
- Knicks to lose: 28¢ (28.56¢ with fee)
- **Total: 99.05¢ = Profit of 0.95¢ per dollar!**

### Bot Actions

1. **Scans** both platforms every 30 seconds
2. **Matches** markets by title
3. **Calculates** profit after fees
4. **Validates** opportunity is still good
5. **Sizes** bets (max 4% of each account)
6. **Places** both bets simultaneously (Fill-or-Kill)
7. **Records** the arbitrage group
8. **Monitors** until resolution

### Risk Management

- **Zero Risk**: Win regardless of outcome
- **No Position Closing**: Let markets resolve naturally
- **Fee Aware**: Accounts for all trading fees
- **Balance Limits**: Never over-expose accounts
- **Time Limits**: Only short-term markets (< 5 days)

## Monitoring & Maintenance

### Daily
- [ ] Check dashboard in morning
- [ ] Verify bot is running
- [ ] Review any new bets

### Weekly
- [ ] Export and analyze data
- [ ] Rebalance account funds if needed
- [ ] Adjust parameters based on results

### Monthly
- [ ] Rotate API keys
- [ ] Review profitability
- [ ] Optimize configuration

## Common Issues

### No Opportunities Found

**Cause**: Markets don't have favorable odds or don't overlap

**Solutions**:
- Lower `MIN_PROFIT_MARGIN` to 0.5%
- Increase `MAX_DAYS_TO_EXPIRY` to 7
- Wait for more volatile markets
- Check both platforms have active markets

### Bets Not Placing

**Cause**: Insufficient balance or API issues

**Solutions**:
- Check account balances on both platforms
- Verify API keys have trading permissions
- Test APIs: `npm run test-apis`
- Review Vercel/console logs for errors

### Bot Stops Running

**Cause**: Vercel serverless timeout or error

**Solutions**:
- Use Vercel Cron (automatic with `vercel.json`)
- Or use external cron (cron-job.org) pinging `/api/bot/cron`
- Check logs for errors: `vercel logs --follow`

## Tips for Success

### Start Conservative
- Begin with 1-2% max bet size
- Use small account balances ($100-200 each)
- Monitor closely for first week

### Gradually Increase
- After successful week, increase to 3%
- After successful month, increase to 4%
- Gradually increase account balances

### Optimize Over Time
- Track which markets are most profitable
- Adjust time windows based on data
- Fine-tune profit margin thresholds

### Stay Informed
- Follow market news
- Understand what you're betting on
- Be aware of market trends

## Safety Checklist

Before going live with real money:

- [ ] Tested with small amounts ($50-100)
- [ ] Verified bets placed correctly on both platforms
- [ ] Confirmed email alerts work
- [ ] Checked all balances update properly
- [ ] Reviewed configuration is conservative
- [ ] Set up monitoring/alerts
- [ ] Exported test data successfully
- [ ] Read through all documentation

## Getting Help

**Documentation**:
- `README.md` - Comprehensive guide
- `SETUP.md` - Detailed setup instructions
- `DEPLOYMENT.md` - Vercel deployment guide

**Resources**:
- [Kalshi API Docs](https://docs.kalshi.com/)
- [Polymarket Docs](https://docs.polymarket.com/)
- [Next.js Docs](https://nextjs.org/docs)
- [Vercel Docs](https://vercel.com/docs)

**Support**:
- Open GitHub issue
- Check existing issues first
- Include error logs and details

## What's Next?

1. **Monitor First Week**: Watch bot closely
2. **Analyze Results**: Export and review data
3. **Optimize**: Adjust based on performance
4. **Scale Up**: Gradually increase limits
5. **Add Markets**: Integrate more prediction markets
6. **Improve**: Enhance algorithms and strategies

## Disclaimer

- Start with small amounts
- Monitor closely
- Past performance doesn't guarantee future results
- Trading involves risk
- You could lose money
- Use at your own risk

## Success Metrics

Track these KPIs:
- **Daily Profit**: Should be positive
- **Success Rate**: % of profitable arbitrage groups
- **ROI**: Return on investment
- **Opportunities Found**: Per day
- **Execution Rate**: % of opportunities executed

**Realistic Expectations**:
- 1-5 opportunities per day (varies by market conditions)
- 0.5-2% profit per arbitrage
- 5-15% monthly ROI (in active markets)

Happy Trading! 🚀💰

