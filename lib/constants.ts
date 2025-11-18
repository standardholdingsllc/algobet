// API URLs
export const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
export const POLYMARKET_API_BASE = 'https://clob.polymarket.com';
export const POLYMARKET_DATA_API = 'https://gamma-api.polymarket.com';

// Fee structures (in percentage)
export const KALSHI_FEE = 7; // 7% fee on profits
export const POLYMARKET_FEE = 2; // 2% fee on trades

// Betting constraints
export const DEFAULT_MAX_BET_PERCENTAGE = 4; // 4% of account balance
export const DEFAULT_MAX_DAYS_TO_EXPIRY = 5; // 5 days
export const MIN_PROFIT_THRESHOLD = 0.5; // 0.5% minimum profit after fees

// Refresh intervals
export const MARKET_SCAN_INTERVAL = 30000; // 30 seconds
export const BALANCE_CHECK_INTERVAL = 300000; // 5 minutes

// Data file paths
export const DATA_FILE_PATH = 'data/store.json';
export const PROFIT_HISTORY_PATH = 'data/profit_history.json';

