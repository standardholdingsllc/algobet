# AlgoBet - Automated Arbitrage Trading Bot

A 24/7 algorithmic betting bot that searches prediction markets (Kalshi and Polymarket) for zero-risk arbitrage opportunities and automatically places bets.

## Features

- **Automated Arbitrage Detection**: Continuously scans Kalshi, Polymarket, and sx.bet for arbitrage opportunities
- **Hot Market Tracking**: 🎯 Automatically tracks markets that exist on multiple platforms and constantly monitors all combinations
  - Once "Yankees vs Red Sox" is found on 2+ bookies, the bot **never stops checking** until the event ends
  - Checks ALL platform combinations every scan (Kalshi-Polymarket, Kalshi-SXbet, Polymarket-SXbet)
  - Live events create the most market dislocation - this ensures we catch every opportunity
- **Adaptive Scanning**: Dynamically adjusts scan frequency (5-30 seconds) based on live event detection
  - **5 seconds** during live sports events globally (European soccer, Asian tennis, etc.)
  - **10 seconds** during high volatility periods
  - **30 seconds** during normal conditions
  - **No time-of-day assumptions** - markets are global 24/7!
- **Intelligent Market Matching**: 5-layer system matches markets across platforms even with different wording
- **Mixed Market Types**: Handles both prediction markets ($1 binary) and sportsbooks (decimal odds)
- **Zero-Risk Trading**: Places bets on both sides of markets when combined odds are favorable
- **Smart Risk Management**:
  - Maximum 10% of account balance per trade side (configurable)
  - Scans all markets but only executes on markets expiring within 10 days (no long lockups)
  - Precise fee-aware calculations (platform-specific)
  - Fill-or-Kill orders to avoid slippage
- **Simulation Mode**: 🧪 Test without risk
  - Run for days/weeks to log all opportunities without placing bets
  - Analyze profitability before going live
  - Export logs in CSV/JSON for detailed analysis
- **Password-Protected Dashboard**: Secure Vercel-hosted web interface
- **Data Export**: Export betting data in CSV or JSON format (daily, weekly, monthly, yearly)
- **Email Alerts**: Notifications when account balances fall below thresholds
- **Performance Tracking**: Daily profit graphs and comprehensive statistics
- **GitHub Storage**: All data stored in JSON files in your GitHub repository

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

#### Generate Admin Password Hash

```bash
node scripts/generate-password-hash.js yourpassword
```

Copy the output hash to your `.env` file as `ADMIN_PASSWORD_HASH`.

#### Required Environment Variables

- **Authentication**:
  - `NEXTAUTH_SECRET`: Random secret key (generate with `openssl rand -base64 32`)
  - `NEXTAUTH_URL`: Your deployment URL (e.g., `https://your-app.vercel.app`)
  - `ADMIN_USERNAME`: Admin username (default: `admin`)
  - `ADMIN_PASSWORD_HASH`: Bcrypt hash from step above

- **Kalshi API**:
  - `KALSHI_API_KEY`: Your Kalshi API key
  - `KALSHI_PRIVATE_KEY`: Your Kalshi private key
  - `KALSHI_EMAIL`: Your Kalshi account email

- **Polymarket API**:
  - `POLYMARKET_API_KEY`: Your Polymarket API key
  - `POLYMARKET_PRIVATE_KEY`: Your Polymarket private key
  - `POLYMARKET_WALLET_ADDRESS`: Your Polymarket wallet address

- **GitHub Storage**:
  - `GITHUB_TOKEN`: GitHub personal access token with repo permissions
  - `GITHUB_OWNER`: Your GitHub username
  - `GITHUB_REPO`: Repository name (default: `AlgoBet`)

- **Email Alerts**:
  - `EMAIL_HOST`: SMTP host (e.g., `smtp.gmail.com`)
  - `EMAIL_PORT`: SMTP port (e.g., `587`)
  - `EMAIL_USER`: Your email address
  - `EMAIL_PASS`: Email password or app-specific password
  - `ALERT_EMAIL`: Email address to receive alerts

### 3. Create GitHub Repository

1. Create a new repository named `AlgoBet` (or your preferred name)
2. Push the `data/storage.json` file to the repository
3. Generate a Personal Access Token with `repo` permissions
4. Add the token to your `.env` file

### 4. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000` and log in with your admin credentials.

### 5. Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Follow the prompts to deploy. Make sure to add all environment variables in the Vercel dashboard.

## How It Works

### Arbitrage Detection

The bot continuously scans both Kalshi and Polymarket for matching markets. An arbitrage opportunity exists when:

```
(Price_A / 100) * (1 + Fee_A / 100) + (Price_B / 100) * (1 + Fee_B / 100) < 1.00
```

For example:
- Kalshi: Knicks to win at 73¢ (0.7% fee)
- Polymarket: Knicks to lose at 28¢ (2% fee)
- Total cost: (0.73 × 1.007) + (0.28 × 1.02) = 1.021 (NO ARBITRAGE)

But if:
- Kalshi: Knicks to win at 73¢ (0.7% fee)
- Polymarket: Knicks to lose at 26¢ (2% fee)
- Total cost: (0.73 × 1.007) + (0.26 × 1.02) = 0.9999 (PROFITABLE!)

### Bet Execution

1. **Market Scanning**: Bot scans ALL markets (up to 30 days out) to find opportunities
2. **Opportunity Detection**: Identifies matching markets with favorable odds across platforms
3. **Execution Filter**: Only executes bets on markets expiring within 10 days (configurable)
   - 💡 You'll see opportunities on longer-dated markets, but won't lock up capital for weeks
4. **Validation**: Checks profit margin meets minimum threshold
5. **Position Sizing**: Calculates optimal bet sizes (max 4% of each account)
6. **Simultaneous Execution**: Places both bets as Fill-or-Kill orders
7. **Verification**: If both fill successfully, saves the arbitrage group; otherwise cancels
8. **Auto-Resolution**: Bets are left to resolve automatically (never closed early)

## Dashboard Features

### Overview

- **Real-time Statistics**: Total profit, active bets, account balances
- **Bot Control**: Start/stop the bot with one click
- **Live Status**: See bot running status in real-time

### Profit Tracking

- **Daily Profit Chart**: Visualize cumulative and daily profits over time
- **ROI Tracking**: Monitor return on investment

### Data Export

Export betting data in CSV or JSON format:
- **Daily**: Last 24 hours
- **Weekly**: Last 7 days
- **Monthly**: Last 30 days
- **Yearly**: Last 365 days

### Configuration

Adjust bot parameters:
- **Max Bet Percentage**: Maximum % of account balance per trade (default: 4%)
- **Max Days to Expiry**: Only bet on markets expiring within X days (default: 5)
- **Min Profit Margin**: Minimum profit % required to place bet (default: 0.5%)
- **Balance Thresholds**: Set alert thresholds for each platform
- **Email Alerts**: Enable/disable email notifications

### Recent Bets Table

View all bets with:
- Date and time
- Platform
- Market details
- Bet side (YES/NO)
- Amount invested
- Status (pending/filled/resolved)
- Profit/loss

## API Endpoints

- `POST /api/bot/control` - Start/stop bot
- `GET /api/bot/status` - Get bot status
- `GET /api/bets` - Get all bets
- `GET /api/stats` - Get daily statistics
- `GET /api/balances` - Get account balances
- `GET /api/config` - Get bot configuration
- `POST /api/config` - Update bot configuration
- `POST /api/export` - Export data

## Security

- **Password Protection**: Dashboard secured with NextAuth.js
- **Environment Variables**: Sensitive data stored in environment variables
- **API Authentication**: All API endpoints require valid session
- **HTTPS**: Use HTTPS in production (automatic with Vercel)

## Monitoring

### Email Alerts

Receive emails when:
- Account balance falls below threshold
- Arbitrage bet is placed (optional)

### Daily Reports

The bot automatically generates daily statistics including:
- Total bets placed
- Active positions
- Resolved bets
- Profit/loss
- ROI

## Simulation Mode (Test Without Risk)

Before risking real money, you can run the bot in **Simulation Mode** to log all arbitrage opportunities without placing bets:

### Enable Simulation Mode

1. Go to **Bot Configuration** in the dashboard
2. Toggle **Simulation Mode: ON**
3. Save configuration

### What It Does

- ✅ Scans all markets normally
- ✅ Finds arbitrage opportunities
- ✅ Logs complete details (event, platforms, odds, profit)
- ✅ Calculates what bets would be placed
- ❌ Does NOT place actual bets

### Export and Analyze

```bash
# Export as CSV
curl "https://your-app.vercel.app/api/export-opportunities?format=csv" > opportunities.csv

# Export as JSON
curl "https://your-app.vercel.app/api/export-opportunities?format=json" > opportunities.json
```

Each log includes:
- Event name and platforms
- Exact odds and prices
- Profit margin percentage
- Dollar profit estimate
- Investment required
- Whether it would have been executed

### Recommended Workflow

1. Enable simulation mode
2. Run for 3-7 days
3. Export logs and analyze in Excel/Python
4. Verify profitability and opportunity frequency
5. Disable simulation mode
6. Start live trading with confidence!

See **[SIMULATION_MODE.md](SIMULATION_MODE.md)** for complete documentation.

## Extending to More Markets

To add support for additional prediction markets:

1. Create a new API class in `lib/markets/` (e.g., `manifold.ts`)
2. Implement the required methods:
   - `getOpenMarkets(maxDaysToExpiry)`
   - `getBalance()`
   - `placeBet(marketId, side, price, quantity)`
3. Update `lib/bot.ts` to include the new market
4. Add configuration for the new platform in types and UI

## Troubleshooting

### Bot Not Finding Opportunities

- Check that API keys are valid and have trading permissions
- Verify markets exist that expire within your max days setting
- Lower the minimum profit margin threshold
- Ensure both platforms have sufficient balance

### Bets Not Executing

- Verify Fill-or-Kill orders are supported by the platform
- Check that account has sufficient balance
- Ensure API keys have trading permissions (not just read-only)

### Data Not Saving

- Verify GitHub token has write permissions to the repository
- Check that `data/storage.json` exists in the repository
- Review API logs for GitHub API errors

## Development

### Project Structure

```
AlgoBet/
├── components/          # React components
├── lib/                # Core logic
│   ├── markets/       # Market API integrations
│   ├── arbitrage.ts   # Arbitrage detection
│   ├── bot.ts         # Bot engine
│   ├── storage.ts     # GitHub storage
│   ├── email.ts       # Email notifications
│   └── export.ts      # Data export
├── pages/             # Next.js pages
│   ├── api/          # API routes
│   ├── dashboard.tsx # Main dashboard
│   └── login.tsx     # Login page
├── types/            # TypeScript types
├── data/             # JSON storage
└── scripts/          # Utility scripts
```

### Running Tests

```bash
# Test environment variables
npm run check-env

# Test API connectivity
npm run test-apis

# Test fee calculations
npm run test-fees

# Test market matching system
npm run test-matching

# Test hot market tracking
npm run test-tracking
```

### Building for Production

```bash
npm run build
npm start
```

## Disclaimer

This bot is for educational purposes. Trading involves risk. The bot makes automated trades based on arbitrage opportunities, but:

- Market conditions can change rapidly
- Fees can vary
- Execution is not guaranteed
- Profits are not guaranteed
- You could lose money

Always start with small amounts and monitor closely. Use at your own risk.

## License

MIT License - see LICENSE file for details

## Support

For issues, questions, or feature requests, please open an issue on GitHub.
