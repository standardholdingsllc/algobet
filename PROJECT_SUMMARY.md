# AlgoBet - Project Summary

## Overview

AlgoBet is a fully automated 24/7 arbitrage trading bot for prediction markets. It continuously scans Kalshi and Polymarket for zero-risk betting opportunities, automatically places bets when favorable odds are found, and provides a comprehensive dashboard for monitoring and management.

## Key Features

### ✅ Automated Arbitrage Detection
- Continuously scans both Kalshi and Polymarket
- Identifies matching markets across platforms
- Calculates profit after fees
- Only executes when guaranteed profit exists

### ✅ Smart Risk Management
- Maximum 4% of account balance per trade
- Only bets on markets expiring within 5 days
- Fee-aware profit calculations
- Fill-or-Kill orders to prevent slippage
- Never closes positions early (auto-resolve only)

### ✅ Password-Protected Dashboard
- Secure NextAuth.js authentication
- Real-time bot control (start/stop)
- Live statistics and metrics
- Profit visualization with charts
- Recent bets table with full details

### ✅ Data Export & Reporting
- Export to CSV or JSON
- Daily, weekly, monthly, yearly reports
- Comprehensive bet history
- Arbitrage group tracking
- Profit/loss analysis

### ✅ Email Alerts
- Low balance warnings
- Configurable thresholds per platform
- Bet placement notifications (optional)
- Error alerts

### ✅ GitHub Storage
- All data stored as JSON in your GitHub repo
- Version controlled
- Easy backups
- Accessible from anywhere

### ✅ Vercel Deployment
- One-click deployment
- Automatic HTTPS
- Serverless architecture
- 24/7 operation with cron jobs
- Free tier available

## Technology Stack

### Frontend
- **Next.js 14**: React framework with SSR
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Modern, responsive UI
- **Recharts**: Data visualization
- **NextAuth.js**: Authentication

### Backend
- **Next.js API Routes**: Serverless functions
- **Node.js**: JavaScript runtime
- **Axios**: HTTP client for API calls
- **Nodemailer**: Email notifications

### Storage
- **GitHub API**: JSON file storage via Octokit
- **Vercel Edge Config**: Runtime configuration

### APIs
- **Kalshi REST API**: Market data and trading
- **Polymarket API**: Market data and trading
- **GitHub API**: Data persistence
- **SMTP**: Email delivery

## Project Structure

```
AlgoBet/
├── components/           # React components
│   ├── DashboardLayout.tsx
│   ├── ProfitChart.tsx
│   ├── StatsCard.tsx
│   ├── BetsTable.tsx
│   └── ConfigPanel.tsx
├── lib/                 # Core business logic
│   ├── markets/        # Market API integrations
│   │   ├── kalshi.ts
│   │   └── polymarket.ts
│   ├── arbitrage.ts    # Arbitrage detection algorithm
│   ├── bot.ts          # Main bot engine
│   ├── storage.ts      # GitHub storage interface
│   ├── email.ts        # Email notifications
│   ├── export.ts       # Data export functionality
│   └── utils.ts        # Utility functions
├── pages/              # Next.js pages
│   ├── api/           # API routes
│   │   ├── auth/      # Authentication
│   │   ├── bot/       # Bot control
│   │   ├── bets.ts
│   │   ├── stats.ts
│   │   ├── balances.ts
│   │   ├── config.ts
│   │   ├── export.ts
│   │   └── health.ts
│   ├── dashboard.tsx  # Main dashboard
│   ├── login.tsx      # Login page
│   ├── index.tsx      # Home redirect
│   └── _app.tsx       # App wrapper
├── types/             # TypeScript type definitions
│   └── index.ts
├── data/              # Data storage
│   └── storage.json   # Persisted bot data
├── scripts/           # Utility scripts
│   ├── generate-password-hash.js
│   ├── check-env.js
│   ├── test-apis.js
│   └── init-storage.sh
├── styles/            # Global styles
│   └── globals.css
├── public/            # Static assets
├── .env.example       # Environment template
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.js
├── vercel.json
├── tailwind.config.js
├── postcss.config.js
├── README.md          # Comprehensive documentation
├── SETUP.md           # Detailed setup guide
├── DEPLOYMENT.md      # Deployment instructions
├── QUICKSTART.md      # Quick start guide
├── ENV_SETUP.md       # Environment config guide
├── PROJECT_SUMMARY.md # This file
└── LICENSE
```

## Core Algorithms

### Arbitrage Detection

```
For each market on Platform A:
  Find matching market on Platform B
  For each side combination (YES/NO):
    cost_A = (price_A / 100) * (1 + fee_A / 100)
    cost_B = (price_B / 100) * (1 + fee_B / 100)
    total_cost = cost_A + cost_B
    
    if total_cost < 1.00:
      profit_margin = ((1.00 - total_cost) / total_cost) * 100
      
      if profit_margin >= min_profit_margin:
        create_arbitrage_opportunity()
```

### Bet Sizing

```
max_bet_A = balance_A * (max_bet_percentage / 100)
max_bet_B = balance_B * (max_bet_percentage / 100)

ratio_A = cost_per_share_A
ratio_B = cost_per_share_B
total_ratio = ratio_A + ratio_B

max_total = min(
  max_bet_A / (ratio_A / total_ratio),
  max_bet_B / (ratio_B / total_ratio)
)

amount_A = max_total * (ratio_A / total_ratio)
amount_B = max_total * (ratio_B / total_ratio)

quantity_A = floor(amount_A / cost_per_share_A)
quantity_B = floor(amount_B / cost_per_share_B)
```

### Execution Flow

```
1. Scan both platforms for markets
2. Filter by expiry date (< max_days)
3. Match markets by normalized title
4. Calculate arbitrage for all combinations
5. Sort by profit margin (highest first)
6. For each opportunity:
   a. Validate still profitable
   b. Calculate bet sizes
   c. Place both bets simultaneously (FOK)
   d. If both succeed: record arbitrage group
   e. If either fails: cancel successful bet
7. Update balances
8. Check thresholds and send alerts
9. Wait 30 seconds
10. Repeat
```

## API Endpoints

### Authentication
- `POST /api/auth/[...nextauth]` - NextAuth.js authentication

### Bot Control
- `GET /api/bot/status` - Get bot running status
- `POST /api/bot/control` - Start/stop bot
- `POST /api/bot/cron` - Cron trigger (keeps bot alive)

### Data Access
- `GET /api/bets` - Get all bets
- `GET /api/stats` - Get daily statistics
- `GET /api/balances` - Get account balances
- `GET /api/config` - Get bot configuration
- `POST /api/config` - Update configuration
- `POST /api/export` - Export data

### Health
- `GET /api/health` - Health check endpoint

## Configuration

### Bot Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxBetPercentage` | 4% | Max % of balance per trade |
| `maxDaysToExpiry` | 5 | Only bet on markets expiring within X days |
| `minProfitMargin` | 0.5% | Minimum profit % to execute |
| `balanceThresholds.kalshi` | $100 | Alert threshold for Kalshi |
| `balanceThresholds.polymarket` | $100 | Alert threshold for Polymarket |
| `emailAlerts` | true | Enable/disable email notifications |

### Environment Variables

**Required (18 total)**:
- Authentication (4): NextAuth secret, URL, username, password hash
- Kalshi API (3): API key, private key, email
- Polymarket API (3): API key, private key, wallet address
- GitHub (3): Token, owner, repo name
- Email (5): Host, port, user, password, alert email

**Optional (2)**:
- Bot config (can be set in dashboard)
- Cron secret (for securing cron endpoint)

## Data Models

### Bet
```typescript
{
  id: string
  timestamp: Date
  platform: 'kalshi' | 'polymarket'
  marketId: string
  ticker: string
  title: string
  side: 'yes' | 'no'
  price: number  // cents
  amount: number  // dollars
  quantity: number  // shares
  status: 'pending' | 'filled' | 'cancelled' | 'resolved'
  resolvedAt?: Date
  payout?: number
  profit?: number
  arbitrageGroupId?: string
}
```

### ArbitrageGroup
```typescript
{
  id: string
  createdAt: Date
  bet1: Bet
  bet2: Bet
  totalInvested: number
  expectedProfit: number
  actualProfit?: number
  status: 'open' | 'partially_resolved' | 'resolved'
  resolvedAt?: Date
}
```

### DailyStats
```typescript
{
  date: string
  totalBets: number
  activeBets: number
  resolvedBets: number
  profit: number
  roi: number
  kalshiBalance: number
  polymarketBalance: number
}
```

## Deployment

### Local Development
```bash
npm install
npm run dev
# Visit http://localhost:3000
```

### Vercel Production
```bash
vercel
vercel --prod
# Live at https://your-app.vercel.app
```

### 24/7 Operation
- Vercel Cron Jobs (every 5 minutes)
- Or external cron service (cron-job.org)
- Pings `/api/bot/cron` to keep bot alive

## Security Features

- Password-protected dashboard (bcrypt hashing)
- Environment variable isolation
- Session-based authentication (JWT)
- API route protection (requires valid session)
- HTTPS by default (Vercel)
- No sensitive data in code or git
- GitHub token with limited scope (repo only)
- Cron endpoint protection (optional secret)

## Monitoring & Alerts

### Dashboard Metrics
- Total profit (all-time)
- Active bets count
- Account balances (real-time)
- Daily profit chart
- Recent bets table

### Email Alerts
- Low balance warnings (configurable threshold)
- Bet placement confirmations (optional)
- Critical errors (optional)

### Logs
- Vercel function logs (via CLI or dashboard)
- Bot activity logs (scan cycles, opportunities found)
- Error logs (API failures, execution issues)

## Performance

### Efficiency
- Scans every 30 seconds
- Processes 100+ markets per scan
- Sub-second arbitrage calculation
- Simultaneous bet placement
- Minimal API calls (caching when possible)

### Scalability
- Serverless architecture (auto-scales)
- No database required
- Stateless design
- Can handle multiple markets
- Easy to add new platforms

### Cost
- **Free Tier Sufficient**: Vercel free tier handles typical usage
- **Serverless Functions**: Only pay for execution time
- **No Database Costs**: GitHub storage is free
- **Email**: Use free Gmail or similar

## Future Enhancements

### Potential Features
- [ ] Additional prediction markets (Manifold, Metaculus, etc.)
- [ ] Machine learning for opportunity prediction
- [ ] Advanced bet sizing strategies (Kelly Criterion)
- [ ] Multi-leg arbitrage (3+ platforms)
- [ ] Historical performance analytics
- [ ] Telegram bot notifications
- [ ] Mobile app
- [ ] Automated rebalancing between platforms
- [ ] Tax reporting
- [ ] Portfolio optimization

### Platform Extensibility
Easy to add new markets by:
1. Creating new API class in `lib/markets/`
2. Implementing required methods
3. Adding to bot scanning loop
4. Updating types and UI

## Known Limitations

### Technical
- Serverless timeout (5 min max per function)
- Rate limits on external APIs
- GitHub API has rate limits (5000/hour)
- Email sending limits (depends on provider)

### Trading
- No live orderbook streaming (polling only)
- Fill-or-Kill only (no partial fills)
- No position closing (auto-resolve only)
- Limited to binary markets
- Depends on API availability

### Market
- Opportunities depend on market inefficiencies
- More volatile markets = more opportunities
- Low liquidity markets may not fill
- Fees vary by platform and volume

## Testing

### Verification Scripts
```bash
npm run check-env    # Verify environment variables
npm run test-apis    # Test API connections
npm run dev         # Run locally
```

### Manual Testing
1. Test with small amounts first ($50-100)
2. Verify both bets placed correctly
3. Confirm email alerts work
4. Check data exports
5. Monitor for 24-48 hours

## Documentation

- **README.md**: Comprehensive project documentation
- **SETUP.md**: Step-by-step setup instructions
- **DEPLOYMENT.md**: Detailed deployment guide
- **QUICKSTART.md**: Get running in 30 minutes
- **ENV_SETUP.md**: Environment variables guide
- **PROJECT_SUMMARY.md**: This file

## Support & Contribution

### Getting Help
- Read documentation first
- Check GitHub issues
- Review API documentation (Kalshi, Polymarket)
- Open new issue with details

### Contributing
- Fork the repository
- Create feature branch
- Make changes
- Test thoroughly
- Submit pull request

## License

MIT License - See LICENSE file

## Disclaimer

**Important**: This software is for educational purposes. Trading involves risk. You could lose money. The bot makes automated trades, but:

- Market conditions change rapidly
- APIs can fail or rate limit
- Fees can vary
- Execution is not guaranteed
- Past performance ≠ future results

**Always**:
- Start with small amounts
- Monitor closely
- Understand the risks
- Use at your own risk

## Contact

For questions, issues, or contributions:
- Open a GitHub issue
- Read the documentation
- Check existing issues first

---

**Built with ❤️ for prediction market enthusiasts**

Last Updated: January 2025
Version: 1.0.0

