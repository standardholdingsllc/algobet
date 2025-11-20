# AlgoBet Architecture Documentation

## Overview

AlgoBet is a sophisticated automated arbitrage trading bot designed to identify and execute zero-risk arbitrage opportunities across multiple prediction market platforms. The system continuously scans for price inefficiencies between Kalshi, Polymarket, and SX.bet, automatically placing bets when profitable opportunities are detected.

**Latest Updates (v1.0.1):**
- ✅ **Concurrency Control**: Added mutex-based protection against overlapping scans
- ✅ **EIP-712 Integration**: Proper domain separator and type definitions for Polymarket CLOB
- ✅ **Web3 Preparation**: SX.bet Web3 integration ready for elevated permissions
- ✅ **Performance Optimization**: Rate-limited pagination with timing telemetry
- ✅ **Type Safety**: Enhanced TypeScript error handling throughout the system

## Core Architecture

### Technology Stack

- **Frontend**: Next.js 14 with React 18, TypeScript
- **Backend**: Next.js API routes (serverless)
- **Database**: Upstash Redis (Vercel KV) for runtime data
- **Deployment**: Vercel serverless platform
- **Authentication**: NextAuth.js with bcrypt password hashing
- **Styling**: Tailwind CSS with Lucide icons
- **External APIs**: Kalshi, Polymarket, SX.bet trading APIs

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Dashboard │    │   Bot Engine    │    │   Market APIs   │
│                 │    │                 │    │                 │
│ - Real-time UI  │    │ - Scan Loop     │    │ - Kalshi       │
│ - Bot Control   │◄──►│ - Opportunity   │◄──►│ - Polymarket   │
│ - Analytics     │    │   Detection     │    │ - SX.bet       │
│ - Configuration │    │ - Bet Execution │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Vercel KV     │    │   Email System  │    │   File Storage  │
│   (Redis)       │    │                 │    │   (GitHub)      │
│                 │    │ - Balance       │    │                 │
│ - Bot Status    │    │   Alerts        │    │ - Logs          │
│ - Trade History │    │ - Notifications │    │ - Backups       │
│ - Configuration │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Recent Technical Improvements

### Concurrency & Race Condition Fixes
- **Mutex Protection**: Added `isScanning` flag to prevent overlapping cron job executions
- **Sequential Processing**: Ensures market scans complete before starting new ones
- **Error Recovery**: Proper cleanup of scanning state on failures

### API Integration Enhancements
- **EIP-712 Compliance**: Proper domain separator and type definitions for Polymarket CLOB
- **Web3 Preparation**: SX.bet balance checking infrastructure ready for elevated permissions
- **Rate Limiting**: 100ms intervals between Polymarket pagination requests
- **Timing Telemetry**: Performance monitoring for API response times

### Type Safety & Error Handling
- **TypeScript Fixes**: Proper error type checking and safe property access
- **Web3 Error Handling**: Graceful fallbacks for permission-restricted operations
- **Logging Corrections**: Eliminated duplicate market count reporting

### Performance Optimizations
- **Sequential Pagination**: Cursor-dependent requests processed in order
- **API Efficiency**: Reduced concurrent requests to respect rate limits
- **Memory Management**: Proper cleanup of concurrent operations

## Detailed Component Breakdown

### 1. Frontend Dashboard (`pages/dashboard.tsx`)

The main user interface built with Next.js and React components.

**Key Features:**
- **Real-time Updates**: Auto-refreshes data every 30 seconds
- **Bot Control**: Start/stop the trading bot with one-click buttons
- **Health Monitoring**: Displays bot status, scan frequency, and error rates
- **Portfolio Overview**: Shows total profit, active bets, and account balances
- **Data Visualization**: Charts showing daily profit trends
- **Configuration Panel**: Adjustable trading parameters
- **Export Functionality**: CSV/JSON export of trading data

**State Management:**
- Local React state for UI components
- API calls to Next.js backend for data fetching
- Real-time balance refresh capabilities

### 2. Bot Engine (`lib/bot.ts`)

The core trading logic implemented as `ArbitrageBotEngine` class with enhanced concurrency protection.

**Main Responsibilities:**
- **Market Scanning**: Continuous loop scanning all platforms with race condition protection
- **Concurrency Control**: Mutex-based `isScanning` flag prevents overlapping cron executions
- **Adaptive Scanning**: Dynamic scan intervals (5s-60s) based on market conditions
- **Opportunity Detection**: Identifies arbitrage opportunities across platforms
- **Risk Management**: Validates opportunities and manages position sizing
- **Bet Execution**: Places simultaneous Fill-or-Kill orders
- **Health Monitoring**: Tracks bot performance and concurrent execution conflicts

**Key Methods:**
```typescript
start(): Promise<void>        // Begins the scanning loop with concurrency checks
stop(): void                  // Stops the bot and resets scanning state
scanOnce(): Promise<void>     // Cron-safe single scan with mutex protection
scanAndExecute(): Promise<void> // Core scan logic with race condition prevention
executeBet(): Promise<void>   // Places arbitrage bets with error recovery
```

**Concurrency Protection:**
- **Mutex Implementation**: `isScanning` flag prevents multiple simultaneous scans
- **Graceful Handling**: Overlapping requests log warnings instead of failing
- **State Management**: Proper flag reset on completion or error

### 3. Arbitrage Detection (`lib/arbitrage.ts`)

Sophisticated algorithm for identifying profitable arbitrage opportunities.

**Core Algorithm:**
- **Market Matching**: 5-layer intelligent matching system using NLP techniques
- **Price Calculation**: Accounts for platform-specific fees and market types
- **Profit Validation**: Ensures opportunities meet minimum profit thresholds
- **Bet Sizing**: Optimizes position sizes based on account balances

**Supported Market Types:**
- **Prediction Markets**: Binary contracts ($1 settlement)
- **Sportsbook Markets**: Decimal odds format
- **Mixed Arbitrage**: Cross-platform opportunities between different market types

### 4. Market API Integrations (`lib/markets/`)

Platform-specific API clients handling authentication and trading operations.

#### Kalshi API (`kalshi.ts`)
- REST API with HMAC-SHA256 authentication
- Supports market scanning, balance queries, and order placement
- Handles fee calculations for different market types

#### Polymarket API (`polymarket.ts`)
- **CLOB API**: REST-based with cursor pagination and EIP-712 authentication
- **EIP-712 Integration**: Proper domain separator for Polygon mainnet CLOB contract
- **Performance Optimized**: Rate-limited pagination (100ms intervals) with timing telemetry
- **Fallback Support**: Blockchain queries when CLOB API unavailable
- **Concurrency Protected**: Mutex-based scan prevention

#### SX.bet API (`sxbet.ts`)
- **Dual Integration**: REST API for markets + Web3 for balances (awaiting elevated permissions)
- **Web3 Ready**: Ethers.js integration prepared for SX Network USDC queries
- **Error Handling**: Type-safe error processing with permission-aware fallbacks
- **Logging Fixed**: Eliminated duplicate market count reporting
- **Future-Proof**: Infrastructure ready for full Web3 balance integration

### 5. Storage Layer (`lib/kv-storage.ts`)

Redis-based data persistence using Vercel's KV store.

**Data Structures:**
```typescript
interface StorageData {
  bets: Bet[]
  arbitrageGroups: ArbitrageGroup[]
  config: BotConfig
  dailyStats: DailyStats[]
  balances: AccountBalance[]
  opportunityLogs: OpportunityLog[]
}
```

**Key Operations:**
- Real-time data updates during trading
- Configuration persistence
- Historical trade storage
- Balance tracking across platforms

### 6. Hot Market Tracking (`lib/hot-market-tracker.ts`)

Intelligent market monitoring system that tracks markets appearing on multiple platforms.

**Features:**
- **Automatic Discovery**: Identifies markets available on 2+ platforms
- **Persistent Tracking**: Never stops monitoring once discovered
- **Platform Combination Analysis**: Checks all platform pairs for each tracked market
- **Live Event Detection**: Prioritizes markets during active events

**Benefits:**
- Catches arbitrage opportunities in real-time during live events
- Reduces computational overhead by focusing on high-potential markets
- Ensures no opportunities are missed during market volatility

### 7. Adaptive Scanning (`lib/adaptive-scanner.ts`)

Dynamic scan interval management based on market conditions.

**Scan Intervals:**
- **5 seconds**: During live sporting events globally
- **10 seconds**: High activity periods
- **30 seconds**: Normal market conditions
- **60 seconds**: Quiet periods

**Detection Logic:**
- Analyzes recent opportunity frequency
- Monitors live event indicators
- Adjusts based on platform volatility
- Balances API rate limits with opportunity capture

### 8. Fee Management (`lib/fees.ts`)

Precise fee calculation system accounting for platform-specific costs.

**Fee Types:**
- **Trading Fees**: Platform commissions on orders
- **Network Fees**: Blockchain transaction costs (Polymarket)
- **Market-Specific Fees**: Different rates for various market types

**Calculation Methods:**
```typescript
calculateTotalCost(platform, ticker, price, quantity, isMaker)
calculateArbitrageProfitMargin(cost1, cost2)
```

### 9. Email Alert System (`lib/email.ts`)

Automated notification system for critical events.

**Alert Types:**
- **Low Balance Warnings**: When account balances fall below thresholds
- **System Health**: Bot failures or connectivity issues
- **Trading Notifications**: Large position alerts (configurable)

### 10. API Routes (`pages/api/`)

Serverless API endpoints handling dashboard and bot operations.

**Core Endpoints:**
- `/api/bot/control`: Start/stop bot operations
- `/api/bot/status`: Real-time bot health monitoring
- `/api/bets`: Trade history and active positions
- `/api/balances`: Account balance information
- `/api/stats`: Performance analytics
- `/api/config`: Configuration management
- `/api/export`: Data export functionality

## Data Flow

### 1. Market Scanning Phase
```
Market APIs → Adaptive Scanner → Hot Market Tracker
     ↓
Opportunity Detection → Validation → Execution Queue
```

### 2. Opportunity Execution
```
Opportunity → Bet Sizing → Fee Calculation → Order Placement
     ↓
Fill Verification → Position Recording → Balance Update
```

### 3. Monitoring & Analytics
```
Trade Data → Statistics Generation → Dashboard Updates
     ↓
Health Checks → Alert System → Email Notifications
```

## Risk Management

### Position Sizing
- **Maximum 10%** of account balance per trade side (configurable)
- **Proportional Allocation**: Balances position sizes across platforms
- **Fee-Aware Calculation**: Accounts for all trading costs

### Execution Controls
- **Fill-or-Kill Orders**: Prevents partial fills and slippage
- **Simultaneous Execution**: Both sides placed together or cancelled
- **Expiry Filtering**: Only trades markets expiring within 10 days

### System Health
- **Concurrency Protection**: Mutex-based prevention of overlapping operations
- **Restart Throttling**: Prevents excessive restart attempts
- **Error Rate Monitoring**: Tracks consecutive failures with type-safe handling
- **Watchdog System**: Monitors bot activity and concurrent execution conflicts

## Configuration System

### Bot Parameters (`BotConfig`)
```typescript
{
  maxBetPercentage: 10,      // Max % of balance per trade
  maxDaysToExpiry: 10,       // Only trade near-term markets
  minProfitMargin: 0.5,      // Minimum profit threshold
  balanceThresholds: {       // Low balance alerts
    kalshi: 100,
    polymarket: 100,
    sxbet: 100
  },
  emailAlerts: {
    enabled: true,
    lowBalanceAlert: true
  },
  simulationMode: false       // Test without real trades
}
```

## Deployment Architecture

### Vercel Serverless Functions
- **API Routes**: Individual serverless functions for each endpoint
- **Bot Engine**: Runs as a serverless cron job or persistent function
- **Auto-scaling**: Scales based on request volume

### Data Persistence
- **Runtime Data**: Vercel KV (Redis) for fast access
- **Configuration**: Environment variables and KV storage
- **Logs**: File-based storage in GitHub repository

### Security Measures
- **Environment Variables**: All sensitive data stored securely
- **API Authentication**: Session-based auth for dashboard
- **Rate Limiting**: Built-in Vercel protections plus custom API rate limiting
- **HTTPS**: Automatic SSL certificate management
- **Concurrency Protection**: Prevents race condition exploits

## Monitoring & Observability

### Health Metrics
- **Scan Frequency**: Average time between market scans
- **Success Rate**: Percentage of successful trades
- **Error Tracking**: Consecutive failures and error types
- **Performance**: Scan duration and API response times

### Logging System
- **Opportunity Logs**: Records all detected opportunities with timing data
- **Trade Logs**: Complete audit trail of all trades with execution details
- **Error Logs**: Detailed error information with type-safe error handling
- **Performance Logs**: API response times, pagination metrics, and scan duration
- **Concurrency Logs**: Race condition detection and mutex status tracking

## Development & Testing

### Testing Infrastructure
- **API Testing**: Individual platform connectivity tests
- **Fee Calculation Tests**: Validates pricing algorithms
- **Market Matching Tests**: Verifies cross-platform matching accuracy
- **Integration Tests**: End-to-end trading simulations

### Development Tools
- **Simulation Mode**: Test strategies without financial risk
- **Debug Scripts**: Individual component testing utilities
- **Environment Validation**: Automated configuration checking

## Future Extensibility

### Adding New Platforms
1. **API Integration**: Create platform-specific API client
2. **Market Parsing**: Implement market data normalization
3. **Fee Calculation**: Add platform-specific fee logic
4. **UI Integration**: Update dashboard components

### Advanced Features
- **Machine Learning**: Predictive market analysis
- **Multi-asset Support**: Expand beyond prediction markets
- **Portfolio Optimization**: Advanced position sizing algorithms
- **Real-time Alerts**: Mobile push notifications

## Performance Characteristics

### Scalability
- **Horizontal Scaling**: Serverless architecture scales automatically
- **Efficient Caching**: Redis-based data storage reduces API calls
- **Batch Processing**: Groups multiple operations for efficiency

### Reliability
- **Concurrency Safety**: Mutex protection prevents overlapping operations
- **Error Recovery**: Automatic restart on failures with proper state cleanup
- **Data Persistence**: Survives deployment restarts and race conditions
- **Graceful Degradation**: Continues operation during partial failures and API outages

### Cost Efficiency
- **Serverless Pricing**: Pay only for actual usage
- **Optimized API Usage**: Intelligent caching and batching
- **Configurable Limits**: Adjustable scan frequencies and thresholds

This architecture provides a robust, scalable foundation for automated arbitrage trading across prediction markets, with sophisticated risk management, comprehensive monitoring capabilities, and enterprise-grade concurrency protection.

## Version History

### v1.0.1 - Concurrency & Performance (Latest)
- ✅ **Concurrency Control**: Added mutex-based scan protection to prevent overlapping executions
- ✅ **EIP-712 Compliance**: Proper domain separator and type definitions for Polymarket CLOB
- ✅ **Web3 Integration**: Prepared SX.bet balance checking infrastructure for elevated permissions
- ✅ **Performance Optimization**: Rate-limited pagination with timing telemetry (100ms intervals)
- ✅ **Type Safety**: Enhanced TypeScript error handling throughout the system
- ✅ **Logging Fixes**: Eliminated duplicate market count reporting and improved error logging

### v1.0.0 - Initial Release
- Core arbitrage engine with Kalshi, Polymarket, and SX.bet integration
- Adaptive scanning with hot market tracking
- Real-time dashboard with bot controls
- Comprehensive risk management and fee calculation
- Serverless deployment on Vercel with Redis persistence
