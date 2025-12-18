/**
 * PM2 Ecosystem Configuration
 * 
 * This file configures the live-arb-worker for production stability.
 * 
 * Key features:
 * - Graceful shutdown with 30s timeout (matches WORKER_SHUTDOWN_GRACE_MS)
 * - Exponential backoff on restarts
 * - Memory limit with auto-restart
 * - Log timestamps
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 restart live-arb-worker
 *   pm2 logs live-arb-worker
 */
module.exports = {
  apps: [
    {
      name: 'live-arb-worker',
      script: 'npx',
      args: 'ts-node --transpile-only workers/live-arb-worker.ts',
      cwd: __dirname,
      
      // Graceful shutdown
      // CRITICAL: kill_timeout must be >= WORKER_SHUTDOWN_GRACE_MS (default 25000)
      kill_timeout: 30000,
      
      // Only shutdown when process exits, not on file change
      listen_timeout: 5000,
      
      // Restart behavior
      min_uptime: 10000,           // Consider started after 10s
      max_restarts: 10,            // Max restarts in 15 min window
      restart_delay: 1000,         // Base delay before restart
      exp_backoff_restart_delay: 1000, // Enable exponential backoff
      
      // Memory management
      max_memory_restart: '1G',    // Restart if memory exceeds 1GB
      
      // Logging
      time: true,                  // Timestamp all logs
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      out_file: 'logs/live-arb-worker-out.log',
      error_file: 'logs/live-arb-worker-error.log',
      merge_logs: true,            // Merge stdout and stderr
      
      // Environment
      env: {
        NODE_ENV: 'production',
      },
      
      // Single instance only
      instances: 1,
      exec_mode: 'fork',
      
      // Don't auto-restart on file changes (not a dev server)
      watch: false,
      
      // Graceful shutdown signals
      // PM2 sends SIGINT first, then SIGTERM after kill_timeout
      // Our worker handles both signals identically
    },
  ],
};

