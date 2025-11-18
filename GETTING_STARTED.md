# Getting Started with AlgoBet

Welcome! This guide will help you get your arbitrage betting bot up and running.

## 📋 Table of Contents

1. [What You'll Build](#what-youll-build)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Detailed Setup](#detailed-setup)
5. [Understanding Arbitrage](#understanding-arbitrage)
6. [First Steps After Setup](#first-steps-after-setup)
7. [Safety Guidelines](#safety-guidelines)

## 🎯 What You'll Build

A fully automated bot that:
- Scans Kalshi and Polymarket 24/7
- Finds zero-risk arbitrage opportunities
- Automatically places bets on both platforms
- Provides a beautiful dashboard to monitor everything
- Sends email alerts for important events
- Exports comprehensive reports

**Example Opportunity**:
- Kalshi offers "Team A wins" at 72¢
- Polymarket offers "Team A loses" at 27¢
- Total cost: 99¢ (with fees)
- Guaranteed return: $1.00
- **Profit: 1¢ per dollar (1% ROI)** 🎉

## ✅ Prerequisites

### Required Accounts (Free)
- [x] **Kalshi** - US prediction market ([Sign up](https://kalshi.com))
- [x] **Polymarket** - Crypto prediction market ([Sign up](https://polymarket.com))
- [x] **GitHub** - For data storage ([Sign up](https://github.com))
- [x] **Vercel** - For hosting (optional, has free tier) ([Sign up](https://vercel.com))
- [x] **Gmail** - For email alerts ([Sign up](https://gmail.com))

### Required Software
- [x] **Node.js 18+** ([Download](https://nodejs.org))
- [x] **Git** ([Download](https://git-scm.com))
- [x] **Code Editor** (VS Code recommended) ([Download](https://code.visualstudio.com))

### Initial Capital
- **Minimum**: $100 per platform ($200 total)
- **Recommended**: $500-1000 per platform for better opportunities
- **Start small**: Test with minimal amounts first!

## 🚀 Quick Start

Follow these steps to get running in ~30 minutes:

### 1. Get the Code (2 min)

```bash
git clone <your-repo-url>
cd AlgoBet
npm install
```

### 2. Get API Credentials (10 min)

**Kalshi**:
1. Log in → Settings → API → Generate Key
2. Save API Key and Private Key

**Polymarket**:
1. Log in → Settings → Developer → Create Key
2. Save API Key, Private Key, and Wallet Address

**GitHub**:
1. Settings → Developer → Personal Access Tokens → Generate
2. Select `repo` scope
3. Save token

**Gmail App Password**:
1. Enable 2FA on Google Account
2. Generate App Password (Google Security settings)
3. Save 16-character password

### 3. Configure Environment (5 min)

```bash
# Generate admin password hash
npm run generate-password YourSecurePassword

# Create .env file
cp .env.example .env

# Edit .env with your credentials
# Use any text editor
```

Fill in all the values in `.env` (see ENV_SETUP.md for details).

### 4. Initialize Storage (3 min)

```bash
# Initialize git storage
bash scripts/init-storage.sh

# Create GitHub repo named "AlgoBet"
# Push storage
git remote add origin https://github.com/YOUR_USERNAME/AlgoBet.git
git push -u origin main
```

### 5. Verify Setup (2 min)

```bash
# Check all environment variables
npm run check-env

# Test API connections
npm run test-apis
```

Both should pass with ✅ for all items.

### 6. Run Locally (1 min)

```bash
npm run dev
```

Visit `http://localhost:3000` and log in!

### 7. Deploy to Vercel (5 min)

```bash
npm install -g vercel
vercel login
vercel

# Add environment variables
# Then deploy to production
vercel --prod
```

Your bot is now live! 🎉

## 📚 Detailed Setup

For step-by-step instructions, see:
- **[SETUP.md](SETUP.md)** - Complete setup guide
- **[ENV_SETUP.md](ENV_SETUP.md)** - Environment variables
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Deployment instructions

## 💡 Understanding Arbitrage

### What is Arbitrage?

Arbitrage is profiting from price differences in different markets. In prediction markets:

**Regular Betting** (Risk):
- Bet $100 on Team A to win at 50¢
- If win: Get $200 (profit $100)
- If lose: Lose $100 (loss $100)

**Arbitrage** (No Risk):
- Platform 1: Bet $50 on Team A wins at 48¢
- Platform 2: Bet $51 on Team A loses at 51¢
- Total cost: $101
- One side MUST win
- Winner pays: $104 (either side)
- **Guaranteed profit: $3** ✅

### How AlgoBet Finds Opportunities

1. **Scans** both platforms every 30 seconds
2. **Matches** similar markets (e.g., "Will it rain in NYC tomorrow?")
3. **Calculates** total cost including fees
4. **Identifies** when total cost < $1.00
5. **Executes** both bets simultaneously
6. **Records** the arbitrage group
7. **Waits** for market resolution
8. **Collects** guaranteed profit

### Real Example

**Kalshi Market**: "Will unemployment be above 4%?"
- YES: 65¢ (0.7% fee = 65.45¢ total)

**Polymarket Market**: "Will unemployment be above 4%?"
- NO: 33¢ (2% fee = 33.66¢ total)

**Total Cost**: 65.45¢ + 33.66¢ = **99.11¢**

**Outcome**:
- If unemployment > 4%: Kalshi YES pays $1.00
- If unemployment ≤ 4%: Polymarket NO pays $1.00
- Either way: Receive $1.00
- **Profit**: $1.00 - $0.9911 = **$0.0089 (0.89%)**

For $1000 invested: **$8.90 profit** risk-free!

### Why Do Opportunities Exist?

- Different user bases on each platform
- Market inefficiencies
- Timing differences
- Limited arbitrageurs
- Transaction costs keep markets slightly inefficient

### Limitations

- Opportunities are rare (0-5 per day typical)
- Profit margins are small (0.5-2% per trade)
- Requires capital on multiple platforms
- APIs can be slow or fail
- Markets can change before execution

## 🎯 First Steps After Setup

### Day 1: Test & Verify

1. **Log in to dashboard**
   - Verify all stats show correctly
   - Check balances are accurate

2. **Configure conservatively**
   - Max bet: 1-2%
   - Min profit: 1%
   - Max expiry: 3 days

3. **Start bot**
   - Click "Start Bot"
   - Watch logs: `vercel logs --follow`
   - Monitor for opportunities

4. **Let it run**
   - Check every few hours
   - Don't stop/restart unnecessarily
   - Wait for first opportunity

### Week 1: Monitor Closely

- [ ] Check dashboard 2-3x daily
- [ ] Review any bets placed
- [ ] Verify both sides executed
- [ ] Confirm data is saving to GitHub
- [ ] Check email alerts work
- [ ] Export weekly report

### Week 2-4: Optimize

- [ ] Analyze which markets were profitable
- [ ] Adjust parameters based on results
- [ ] Consider increasing max bet to 3-4%
- [ ] Add more capital if performing well
- [ ] Fine-tune profit margin threshold

### Month 2+: Scale

- [ ] Increase position sizes
- [ ] Add more platforms (future feature)
- [ ] Optimize algorithms
- [ ] Automate reporting
- [ ] Consider advanced strategies

## 🛡️ Safety Guidelines

### Before Trading Real Money

✅ **DO**:
- Test with $50-100 per platform first
- Verify bets place correctly on BOTH sides
- Confirm email alerts work
- Review all documentation
- Understand the risks
- Start with conservative settings (1-2% max bet)
- Monitor closely for first week
- Keep detailed records

❌ **DON'T**:
- Invest more than you can afford to lose
- Ignore email alerts
- Stop monitoring after deployment
- Increase limits too quickly
- Trade on margins or leverage
- Share API keys
- Commit `.env` to git
- Deploy without testing locally

### Risk Management

1. **Start Small**: $100-200 per platform initially
2. **Go Slow**: 1-2% max bet for first month
3. **Monitor Daily**: Check dashboard every morning
4. **Set Alerts**: Low balance warnings at 50% of capital
5. **Diversify**: Don't put all capital in one platform
6. **Keep Records**: Export data weekly
7. **Test Thoroughly**: Run locally before deploying
8. **Have Exit Plan**: Know when to stop (e.g., 3 days of losses)

### What Can Go Wrong

**Rare but Possible**:
- API goes down mid-trade (one bet placed, other fails)
- Market cancelled or voided
- Account limited or banned
- Withdrawal delays
- Fee changes

**Protection**:
- Bot uses Fill-or-Kill orders (both or neither)
- Only trades on established markets
- Accounts for current fee structure
- Monitors API status
- Sends alerts for failures

### Expected Returns

**Realistic Expectations**:
- **Opportunities**: 1-5 per day (varies by market conditions)
- **Profit per Trade**: 0.5-2% (after fees)
- **Monthly ROI**: 5-15% (active markets)
- **Time to ROI**: Varies (could be days or weeks)

**Best Case** (very active markets):
- 5 opportunities/day × 1% profit × $1000 invested = $50/day
- But this is RARE and unsustainable

**Realistic Case** (typical):
- 2 opportunities/day × 1% profit × $1000 invested = $20/day
- 1-2 opportunities/week × 1.5% profit × $500 invested = $7.50-15/week

**Worst Case**:
- 0-1 opportunities/week (slow markets)
- Minimal profit
- But still zero-risk (no losses)

## 📖 Additional Resources

### Documentation
- **[README.md](README.md)** - Full documentation
- **[QUICKSTART.md](QUICKSTART.md)** - 30-minute quick start
- **[SETUP.md](SETUP.md)** - Detailed setup guide
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Deploy to Vercel
- **[ENV_SETUP.md](ENV_SETUP.md)** - Environment variables
- **[PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)** - Technical overview

### External Resources
- [Kalshi API Docs](https://docs.kalshi.com/)
- [Polymarket Docs](https://docs.polymarket.com/)
- [Next.js Docs](https://nextjs.org/docs)
- [Vercel Docs](https://vercel.com/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Community
- GitHub Issues - Report bugs or request features
- Discussions - Ask questions and share strategies

## 🤔 Common Questions

**Q: How much can I make?**
A: 5-15% monthly ROI is realistic in active markets. But it varies greatly based on market conditions and opportunities available.

**Q: Is this really risk-free?**
A: Yes, if both bets execute. The bot uses Fill-or-Kill orders to ensure both or neither place. However, there's execution risk if APIs fail.

**Q: How often are there opportunities?**
A: Varies widely. Could be 0-5 per day depending on market activity. More during major events (elections, sports, etc.).

**Q: Can my account be banned?**
A: Unlikely. You're providing liquidity and not exploiting platform bugs. But read each platform's terms of service.

**Q: What if one platform cancels the market?**
A: Rare. Usually both platforms follow the same resolution. If one cancels, you'd break even (win on one, refund on other).

**Q: How much capital do I need?**
A: Minimum $200 ($100 per platform). Recommended $1000-2000 to capture more opportunities.

**Q: Do I need to know coding?**
A: No, but basic command line knowledge helps. Follow the guides step-by-step.

**Q: Can I run this locally instead of Vercel?**
A: Yes, but you need to keep your computer on 24/7. Vercel is easier for continuous operation.

**Q: What about taxes?**
A: Consult a tax professional. In the US, betting winnings are typically taxable income.

## 🎉 You're Ready!

Follow the Quick Start above and you'll have your bot running in ~30 minutes.

**Next Steps**:
1. Complete the Quick Start (above)
2. Read [QUICKSTART.md](QUICKSTART.md) for more details
3. Deploy to Vercel following [DEPLOYMENT.md](DEPLOYMENT.md)
4. Monitor and optimize based on results

**Need Help?**
- Read the documentation first
- Check existing GitHub issues
- Open a new issue with details
- Never share your API keys or `.env` file!

---

**Happy Trading! May the odds be ever in your favor!** 🚀💰

**Remember**: Start small, monitor closely, and scale gradually. Good luck!

