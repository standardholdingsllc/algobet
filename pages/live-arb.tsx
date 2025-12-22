/**
 * Live Arbitrage Monitoring Dashboard
 *
 * Displays real-time status of the live arbitrage system including:
 * - Overall system status (enabled/ready)
 * - Dry-fire (paper trading) mode status and stats
 * - Live betting bot controls
 * - Per-platform WebSocket connection status
 * - Live markets with prices
 * - Circuit breaker state
 * - CSV export functionality
 */

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { 
  RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle, XCircle,
  Play, Square, Download, FileText, TrendingUp, Activity, ShieldAlert, Zap
} from 'lucide-react';

// Types
interface PlatformStatus {
  connected: boolean;
  state: string;
  lastMessageAt: string | null;
  /** Computed at read-time by the API using server's Date.now() */
  lastMessageAgeMs?: number | null;
  /** Computed at read-time: true if connected but lastMessageAgeMs > 60s */
  isStale?: boolean;
  subscribedMarkets: number;
  errorMessage?: string;
}

/** KV status - explicit reason when data is missing */
type KVStatus = 'ok' | 'misconfigured' | 'no_heartbeat' | 'parse_error' | 'kv_unreachable';

interface LiveArbStatus {
  /** KV status - explicit reason when data is missing */
  kvStatus?: KVStatus;
  /** Human-readable explanation for kvStatus */
  kvStatusReason?: string;
  workerPresent: boolean;
  workerState: WorkerState;
  workerHeartbeatAt: string | null;
  runtimeConfig: LiveArbRuntimeConfigData | null;
  liveArbEnabled: boolean;
  liveArbReady: boolean;
  timestamp: string;
  platforms: {
    sxbet: PlatformStatus;
    polymarket: PlatformStatus;
    kalshi: PlatformStatus;
  };
  priceCacheStats: {
    totalEntries: number;
    entriesByPlatform: Record<string, number>;
    totalPriceUpdates: number;
    oldestUpdateMs?: number;
    newestUpdateMs?: number;
  };
  circuitBreaker: {
    isOpen: boolean;
    consecutiveFailures: number;
    openReason?: string;
    openedAt?: string;
  };
  subscriptionStats: {
    lastUpdateAt?: string;
    updateCount: number;
    currentSubscriptions: Record<string, number>;
    blockedOpportunities: number;
    blockedReasons: Record<string, number>;
  };
}

interface DryFireStats {
  dryFireModeEnabled: boolean;
  totalSimulated: number;
  totalRejectedBySafety: number;
  totalRejectedByRisk: number;
  totalRejectedByValidation: number;
  totalPotentialProfitUsd: number;
  avgProfitPerTradeUsd: number;
  profitBuckets: Record<string, number>;
  generatedAt: string;
}

/**
 * Watched market info from KV-backed API.
 * Note: Live prices are NOT available on Vercel serverless.
 * The DO worker maintains prices in-memory via LivePriceCache.
 */
interface WatchedMarket {
  id: string;
  platform: string;
  vendorMarketId: string;
  eventKey: string;
  sport: string;
  status: 'PRE' | 'LIVE' | 'ENDED';
  rawTitle: string;
  homeTeam?: string;
  awayTeam?: string;
}

interface PlatformStats {
  platform: string;
  watchedMarkets: number;
  connected: boolean;
  lastMessageAt: string | null;
  lastMessageAgeMs: number | null;
  isStale: boolean;
  subscribedMarkets: number;
}

interface LiveMarketsResponse {
  watchedMarkets: WatchedMarket[];
  totalWatchedMarkets: number;
  filteredCount: number;
  platformStats: PlatformStats[];
  priceCacheStats: {
    totalEntries: number;
    entriesByPlatform: Record<string, number>;
    totalPriceUpdates: number;
    lastPriceUpdateAt?: string;
  };
  workerPresent: boolean;
  workerState: string | null;
  snapshotUpdatedAt: string | null;
  snapshotAgeMs: number | null;
  timestamp: string;
  filters: {
    platform?: string;
    liveOnly?: boolean;
    limit: number;
  };
  notice?: string;
}

interface ExecutionModeData {
  mode: 'DRY_FIRE' | 'LIVE';
  configMode?: 'DRY_FIRE' | 'LIVE';
  isDryFire: boolean;
}

// Rule-based matcher types
interface MatchedEventGroup {
  eventKey: string;
  sport: string;
  homeTeam?: string;
  awayTeam?: string;
  status: 'PRE' | 'LIVE' | 'ENDED';
  platformCount: number;
  matchQuality: number;
  vendors: Record<string, any[]>;
}

interface EventWatcherInfo {
  eventKey: string;
  state: string;
  arbCheckCount: number;
  opportunitiesFound: number;
  lastOpportunity?: {
    profitMargin: number;
    platforms: string[];
    foundAt: number;
  };
}

interface LiveEventsDebugInfo {
  schemaVersion: number;
  matchupCountsByPlatform: Record<string, number>;
  matchupKeyMissingByPlatform: Record<string, number>;
  sampleMatchupKeysByPlatform: Record<string, string[]>;
  sampleKalshiTitles: string[];
  eventFieldPresence: {
    hasMarketKind: boolean;
    hasMatchupKey: boolean;
    hasNormalizedTitle: boolean;
    hasHomeTeam: boolean;
    hasAwayTeam: boolean;
  };
  countsBySport: Record<string, number>;
  sampleEventsByPlatform: Record<string, Array<{
    vendorMarketId: string;
    rawTitle: string;
    sport: string;
    status: string;
    homeTeam?: string;
    awayTeam?: string;
  }>>;
  matchedGroupEventKeys: string[];
  snapshotAgeWarning: boolean;
}

interface LiveEventsData {
  enabled: boolean;
  running: boolean;
  uptimeMs: number;
  workerPresent: boolean;
  snapshotAge: number | null;
  snapshotUpdatedAt: string | null;
  config: {
    enabled: boolean;
    sportsOnly: boolean;
    timeToleranceMinutes: number;
    maxWatchers: number;
    minPlatforms: number;
  };
  stats: {
    totalVendorEvents: number;
    liveEvents: number;
    preEvents: number;
    matchedGroups: number;
    activeWatchers: number;
    arbChecksTotal: number;
    opportunitiesTotal: number;
  };
  matcher: {
    threeWayMatches: number;
    twoWayMatches: number;
  };
  watchers: {
    stats: {
      avgCheckTimeMs: number;
      maxCheckTimeMs: number;
      totalMarketsWatched: number;
    };
  };
  eventsByPlatform: {
    sxbet: number;
    polymarket: number;
    kalshi: number;
  };
  matchedGroups: MatchedEventGroup[];
  debug?: LiveEventsDebugInfo;
}

interface LiveArbRuntimeConfigData {
  liveArbEnabled: boolean;
  ruleBasedMatcherEnabled: boolean;
  sportsOnly: boolean;
  liveEventsOnly: boolean;
}

// Status indicator component
function StatusIndicator({ status }: { status: PlatformStatus }) {
  // Handle disabled state (e.g., missing env var)
  if (status.state === 'disabled') {
    return (
      <div className="flex items-center gap-2 text-yellow-400">
        <AlertTriangle className="w-4 h-4" />
        <span>Disabled</span>
      </div>
    );
  }

  // Handle no_worker state (no heartbeat from worker)
  if (status.state === 'no_worker') {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <WifiOff className="w-4 h-4" />
        <span>No Heartbeat</span>
      </div>
    );
  }

  // Handle initializing state (worker present but platform status not yet populated)
  if (status.state === 'initializing') {
    return (
      <div className="flex items-center gap-2 text-blue-400">
        <Activity className="w-4 h-4 animate-pulse" />
        <span>Initializing</span>
      </div>
    );
  }

  return status.connected ? (
    <div className="flex items-center gap-2 text-green-400">
      <Wifi className="w-4 h-4" />
      <span>Connected</span>
    </div>
  ) : (
    <div className="flex items-center gap-2 text-red-400">
      <WifiOff className="w-4 h-4" />
      <span>Disconnected</span>
    </div>
  );
}

// Platform card component with staleness detection
function PlatformCard({
  name,
  status,
  isStale,
}: {
  name: string;
  status: PlatformStatus;
  /** True if connected but no message in >60s */
  isStale?: boolean;
}) {
  const isDisabled = status.state === 'disabled';
  const borderClass = isDisabled 
    ? 'border-yellow-700/50' 
    : isStale
      ? 'border-orange-700/50'
      : status.connected 
        ? 'border-green-700/50' 
        : 'border-gray-700';

  return (
    <div className={`bg-gray-800 rounded-lg p-4 border ${borderClass}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-white capitalize">{name}</h3>
          {isStale && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-900/30 text-orange-300 border border-orange-700/50">
              Stale
            </span>
          )}
        </div>
        <StatusIndicator status={status} />
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">State</span>
          <span className={`${isDisabled ? 'text-yellow-300' : 'text-gray-200'}`}>
            {formatStateLabel(status.state)}
          </span>
        </div>
        {!isDisabled && (
          <div className="flex justify-between">
            <span className="text-gray-400">Subscribed Markets</span>
            <span className="text-gray-200">{status.subscribedMarkets}</span>
          </div>
        )}
        {status.lastMessageAt && (
          <div className="flex justify-between">
            <span className="text-gray-400">Last Message</span>
            <span className={`${isStale ? 'text-orange-300' : 'text-gray-200'}`}>
              {formatTimeAgo(status.lastMessageAt)}
              {isStale && ' ⚠️'}
            </span>
          </div>
        )}
        {status.errorMessage && (
          <div className={`mt-2 p-2 rounded text-xs ${
            isDisabled 
              ? 'bg-yellow-900/20 border border-yellow-700/50 text-yellow-300'
              : 'bg-red-900/20 border border-red-700/50 text-red-300'
          }`}>
            {status.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}

// Format state label for better readability
function formatStateLabel(state: string): string {
  switch (state) {
    case 'disabled': return 'Disabled (Config)';
    case 'no_worker': return 'No Worker';
    case 'not_initialized': return 'Not Initialized';
    case 'idle': return 'Idle';
    case 'initializing': return 'Initializing...';
    case 'connecting': return 'Connecting...';
    case 'connected': return 'Connected';
    case 'disconnected': return 'Disconnected';
    case 'reconnecting': return 'Reconnecting...';
    case 'error': return 'Error';
    default: return state;
  }
}

// Format time ago
function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  
  if (diffMs < 1000) return 'just now';
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  return `${Math.floor(diffMs / 3600000)}h ago`;
}

// KV Status Banner - shows diagnostic info when KV has issues
function KVStatusBanner({ kvStatus, kvStatusReason }: { kvStatus?: KVStatus; kvStatusReason?: string }) {
  if (!kvStatus || kvStatus === 'ok') return null;

  const statusConfig: Record<KVStatus, { icon: React.ReactNode; bgClass: string; title: string }> = {
    ok: { icon: <CheckCircle className="w-5 h-5" />, bgClass: 'bg-green-900/30 border-green-700/50 text-green-300', title: 'KV Connected' },
    misconfigured: { 
      icon: <AlertTriangle className="w-5 h-5" />, 
      bgClass: 'bg-red-900/30 border-red-700/50 text-red-300', 
      title: 'KV Misconfigured' 
    },
    no_heartbeat: { 
      icon: <AlertTriangle className="w-5 h-5" />, 
      bgClass: 'bg-yellow-900/30 border-yellow-700/50 text-yellow-300', 
      title: 'No Worker Heartbeat' 
    },
    parse_error: { 
      icon: <XCircle className="w-5 h-5" />, 
      bgClass: 'bg-red-900/30 border-red-700/50 text-red-300', 
      title: 'Heartbeat Parse Error' 
    },
    kv_unreachable: { 
      icon: <WifiOff className="w-5 h-5" />, 
      bgClass: 'bg-red-900/30 border-red-700/50 text-red-300', 
      title: 'KV Unreachable' 
    },
  };

  const config = statusConfig[kvStatus] || statusConfig.kv_unreachable;

  return (
    <div className={`rounded-lg p-4 border ${config.bgClass} mb-6`}>
      <div className="flex items-start gap-3">
        {config.icon}
        <div className="flex-1">
          <h4 className="font-semibold">{config.title}</h4>
          <p className="text-sm opacity-90 mt-1">{kvStatusReason}</p>
          {kvStatus === 'misconfigured' && (
            <p className="text-xs opacity-75 mt-2">
              Check that <code className="bg-black/20 px-1 rounded">KV_REST_API_URL</code> and{' '}
              <code className="bg-black/20 px-1 rounded">KV_REST_API_TOKEN</code> are set in Vercel environment variables.
            </p>
          )}
          {kvStatus === 'no_heartbeat' && (
            <p className="text-xs opacity-75 mt-2">
              The worker may not be running, or Vercel may be reading from a different KV instance than the DO worker writes to.
              Use <code className="bg-black/20 px-1 rounded">/api/debug/kv</code> to diagnose.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Dry Fire Stats Card
function DryFireStatsCard({ stats }: { stats: DryFireStats }) {
  const totalTrades = stats.totalSimulated + stats.totalRejectedBySafety + 
                      stats.totalRejectedByRisk + stats.totalRejectedByValidation;
  
  return (
    <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <FileText className="w-5 h-5 text-amber-400" />
          Dry-Fire Statistics
        </h3>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
          stats.dryFireModeEnabled 
            ? 'bg-amber-900/30 text-amber-300 border border-amber-700/50' 
            : 'bg-gray-700 text-gray-400'
        }`}>
          {stats.dryFireModeEnabled ? 'PAPER MODE' : 'LIVE MODE'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-green-400">{stats.totalSimulated}</div>
          <div className="text-xs text-gray-400">Would Execute</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-yellow-400">{stats.totalRejectedBySafety}</div>
          <div className="text-xs text-gray-400">Blocked (Safety)</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-red-400">{stats.totalRejectedByRisk}</div>
          <div className="text-xs text-gray-400">Blocked (Risk)</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-blue-400">
            ${stats.totalPotentialProfitUsd.toFixed(2)}
          </div>
          <div className="text-xs text-gray-400">Potential Profit</div>
        </div>
      </div>

      {/* Profit Buckets */}
      {totalTrades > 0 && (
        <div className="border-t border-gray-700 pt-4">
          <div className="text-sm text-gray-400 mb-2">Profit Distribution (simulated trades)</div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(stats.profitBuckets).map(([bucket, count]) => (
              <span key={bucket} className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">
                {bucket}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Bot Control Panel
type WorkerState = 'STARTING' | 'RUNNING' | 'IDLE' | 'STOPPING' | 'STOPPED' | null;

function BotControlPanel({
  liveArbEnabled,
  workerPresent,
  workerState,
  workerHeartbeatAt,
  executionMode,
  onStart,
  onStop,
  isLoading,
}: {
  liveArbEnabled: boolean;
  workerPresent: boolean;
  workerState: WorkerState;
  workerHeartbeatAt: string | null;
  executionMode: ExecutionModeData | null;
  onStart: () => void;
  onStop: () => void;
  isLoading: boolean;
}) {
  const isDryFire = executionMode?.isDryFire ?? true;
  const isStopping = workerState === 'STOPPING';
  const isStarting = workerState === 'STARTING';
  
  // Determine status label based on worker lifecycle state
  const getStatusLabel = () => {
    if (isStopping) return 'STOPPING';
    if (isStarting) return 'STARTING';
    if (liveArbEnabled) {
      if (workerPresent) {
        return workerState === 'RUNNING' ? 'RUNNING' : 'IDLE';
      }
      return 'ENABLED (NO HEARTBEAT)';
    }
    return 'STOPPED';
  };
  
  const statusLabel = getStatusLabel();
  
  // Status style - purple for transitional states
  const getStatusStyle = () => {
    if (isStopping || isStarting) {
      return 'bg-purple-900/30 text-purple-300 border border-purple-700/50';
    }
    if (liveArbEnabled) {
      return workerPresent
        ? 'bg-green-900/30 text-green-300 border border-green-700/50'
        : 'bg-yellow-900/30 text-yellow-300 border border-yellow-700/50';
    }
    return 'bg-gray-700 text-gray-400';
  };
  
  const statusStyle = getStatusStyle();

  return (
    <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          Live Betting Bot
        </h3>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusStyle}`}>
          {statusLabel}
        </span>
      </div>

      {isDryFire && (
        <div className="mb-4 p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg">
          <div className="flex items-center gap-2 text-amber-300 text-sm">
            <AlertTriangle className="w-4 h-4" />
            <span>Dry-fire mode is active. No real orders will be placed.</span>
          </div>
        </div>
      )}

      {isStopping && (
        <div className="mb-4 p-3 bg-purple-900/20 border border-purple-700/50 rounded-lg text-sm text-purple-200">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Worker is shutting down gracefully...</span>
          </div>
        </div>
      )}
      
      {isStarting && (
        <div className="mb-4 p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg text-sm text-blue-200">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Worker is starting up...</span>
          </div>
        </div>
      )}
      
      {liveArbEnabled && !workerPresent && !isStopping && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-700/50 rounded-lg text-sm text-red-200">
          Live Arb is enabled in KV, but no worker heartbeat has been detected. Make sure
          `npm run live-arb-worker` is running.
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={onStart}
          disabled={isLoading || liveArbEnabled || isStopping || isStarting}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            liveArbEnabled || isStopping || isStarting
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : isDryFire
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          <Play className="w-4 h-4" />
          {isDryFire ? 'Start Paper Trading' : 'Start Live Bot'}
        </button>

        <button
          onClick={onStop}
          disabled={isLoading || !liveArbEnabled || isStopping}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            !liveArbEnabled || isStopping
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          <Square className="w-4 h-4" />
          {isStopping ? 'Stopping...' : 'Stop Bot'}
        </button>
      </div>

      {(workerHeartbeatAt || workerState) && (
        <div className="mt-4 pt-4 border-t border-gray-700 text-sm text-gray-400">
          {workerHeartbeatAt && (
            <div className="flex justify-between">
              <span>Last Heartbeat</span>
              <span>{formatTimeAgo(workerHeartbeatAt)}</span>
            </div>
          )}
          {workerState && (
            <div className="flex justify-between mt-1">
              <span>Worker State</span>
              <span className="text-gray-200">{workerState}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Debug Panel for diagnosing matching issues
function MatcherDebugPanel({ debug, snapshotAge }: { debug: LiveEventsDebugInfo | undefined; snapshotAge: number | null }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!debug) {
    return null;
  }
  
  const snapshotAgeSeconds = snapshotAge ? Math.round(snapshotAge / 1000) : null;
  const isStale = snapshotAge !== null && snapshotAge > 60000;
  
  return (
    <div className="mt-4 border-t border-gray-700 pt-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
        <span>Debug Info (Schema v{debug.schemaVersion})</span>
        {isStale && (
          <span className="px-2 py-0.5 rounded text-xs bg-yellow-900/30 text-yellow-300">
            Stale ({snapshotAgeSeconds}s old)
          </span>
        )}
      </button>
      
      {isExpanded && (
        <div className="mt-3 space-y-4 text-xs">
          {/* Snapshot Status */}
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="font-medium text-gray-300 mb-2">Snapshot Status</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-gray-500">Age:</span>{' '}
                <span className={isStale ? 'text-yellow-300' : 'text-green-300'}>
                  {snapshotAgeSeconds !== null ? `${snapshotAgeSeconds}s` : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Warning:</span>{' '}
                <span className={debug.snapshotAgeWarning ? 'text-yellow-300' : 'text-green-300'}>
                  {debug.snapshotAgeWarning ? 'Yes (>60s)' : 'No'}
                </span>
              </div>
            </div>
          </div>
          
          {/* Field Presence */}
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="font-medium text-gray-300 mb-2">Event Field Presence</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(debug.eventFieldPresence).map(([field, present]) => (
                <span
                  key={field}
                  className={`px-2 py-1 rounded ${
                    present ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'
                  }`}
                >
                  {field}: {present ? '✓' : '✗'}
                </span>
              ))}
            </div>
          </div>
          
          {/* Matchup Counts by Platform */}
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="font-medium text-gray-300 mb-2">Matchup Counts by Platform</div>
            <div className="grid grid-cols-3 gap-2">
              {['SXBET', 'POLYMARKET', 'KALSHI'].map(platform => (
                <div key={platform} className="text-center">
                  <div className={`text-lg font-bold ${
                    platform === 'SXBET' ? 'text-orange-300' :
                    platform === 'POLYMARKET' ? 'text-purple-300' : 'text-blue-300'
                  }`}>
                    {debug.matchupCountsByPlatform[platform] || 0}
                  </div>
                  <div className="text-gray-500">{platform}</div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Missing MatchupKey Counts */}
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="font-medium text-gray-300 mb-2">Events Missing MatchupKey</div>
            <div className="grid grid-cols-3 gap-2">
              {['SXBET', 'POLYMARKET', 'KALSHI'].map(platform => (
                <div key={platform} className="text-center">
                  <div className={`text-lg font-bold ${
                    (debug.matchupKeyMissingByPlatform[platform] || 0) > 0 ? 'text-yellow-300' : 'text-green-300'
                  }`}>
                    {debug.matchupKeyMissingByPlatform[platform] || 0}
                  </div>
                  <div className="text-gray-500">{platform}</div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Counts by Sport */}
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="font-medium text-gray-300 mb-2">Events by Sport</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(debug.countsBySport).map(([sport, count]) => (
                <span key={sport} className="px-2 py-1 rounded bg-cyan-900/30 text-cyan-300">
                  {sport}: {count}
                </span>
              ))}
              {Object.keys(debug.countsBySport).length === 0 && (
                <span className="text-gray-500">No events</span>
              )}
            </div>
          </div>
          
          {/* Sample Kalshi Titles */}
          {debug.sampleKalshiTitles.length > 0 && (
            <div className="bg-gray-900/50 rounded-lg p-3">
              <div className="font-medium text-gray-300 mb-2">Sample Kalshi Titles</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {debug.sampleKalshiTitles.map((title, idx) => (
                  <div key={idx} className="text-gray-400 truncate" title={title}>
                    {idx + 1}. {title}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Sample MatchupKeys */}
          {Object.values(debug.sampleMatchupKeysByPlatform).some(arr => arr.length > 0) && (
            <div className="bg-gray-900/50 rounded-lg p-3">
              <div className="font-medium text-gray-300 mb-2">Sample MatchupKeys</div>
              {['SXBET', 'POLYMARKET', 'KALSHI'].map(platform => {
                const keys = debug.sampleMatchupKeysByPlatform[platform] || [];
                if (keys.length === 0) return null;
                return (
                  <div key={platform} className="mb-2">
                    <div className={`text-xs font-medium ${
                      platform === 'SXBET' ? 'text-orange-300' :
                      platform === 'POLYMARKET' ? 'text-purple-300' : 'text-blue-300'
                    }`}>{platform}:</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {keys.slice(0, 5).map((key, idx) => (
                        <code key={idx} className="px-1 py-0.5 bg-gray-800 rounded text-gray-400 text-xs">
                          {key.length > 40 ? key.slice(0, 40) + '...' : key}
                        </code>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Matched Group Event Keys */}
          {debug.matchedGroupEventKeys.length > 0 && (
            <div className="bg-gray-900/50 rounded-lg p-3">
              <div className="font-medium text-gray-300 mb-2">Matched Group Keys ({debug.matchedGroupEventKeys.length})</div>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {debug.matchedGroupEventKeys.slice(0, 20).map((key, idx) => (
                  <code key={idx} className="px-1 py-0.5 bg-green-900/30 rounded text-green-300 text-xs">
                    {key.length > 30 ? key.slice(0, 30) + '...' : key}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Rule-Based Matcher Card
function RuleBasedMatcherCard({
  data,
  runtimeConfig,
}: {
  data: LiveEventsData | null;
  runtimeConfig: LiveArbRuntimeConfigData | null;
}) {
  if (!data) {
    return (
      <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          Rule-Based Sports Matcher
        </h3>
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  const matcherEnabled =
    runtimeConfig?.ruleBasedMatcherEnabled ?? data.enabled;
  const uptimeMinutes = Math.floor((data.uptimeMs || 0) / 60000);
  const snapshotAgeSeconds = data.snapshotAge ? Math.round(data.snapshotAge / 1000) : null;

  return (
    <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          Rule-Based Sports Matcher
        </h3>
        <div className="flex items-center gap-2">
          {data.workerPresent && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-green-900/30 text-green-300">
              WORKER OK
            </span>
          )}
          {!data.workerPresent && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-red-900/30 text-red-300">
              NO WORKER
            </span>
          )}
          {data.running && matcherEnabled && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-green-900/30 text-green-300">
              RUNNING
            </span>
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            matcherEnabled 
              ? 'bg-cyan-900/30 text-cyan-300 border border-cyan-700/50' 
              : 'bg-gray-700 text-gray-400'
          }`}>
            {matcherEnabled ? 'ENABLED' : 'DISABLED'}
          </span>
        </div>
      </div>

      {/* Snapshot Age Indicator */}
      {snapshotAgeSeconds !== null && (
        <div className={`mb-4 text-xs ${snapshotAgeSeconds > 60 ? 'text-yellow-400' : 'text-gray-500'}`}>
          Snapshot age: {snapshotAgeSeconds}s
          {data.snapshotUpdatedAt && (
            <span className="ml-2">
              (updated: {new Date(data.snapshotUpdatedAt).toLocaleTimeString()})
            </span>
          )}
        </div>
      )}

      {/* Main Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-cyan-400">{data.stats.totalVendorEvents}</div>
          <div className="text-xs text-gray-400">Vendor Events</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-green-400">{data.stats.matchedGroups}</div>
          <div className="text-xs text-gray-400">Matched Groups</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-purple-400">{data.stats.activeWatchers}</div>
          <div className="text-xs text-gray-400">Active Watchers</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-yellow-400">{data.stats.opportunitiesTotal}</div>
          <div className="text-xs text-gray-400">Opportunities Found</div>
        </div>
      </div>

      {/* Event Breakdown */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-900/30 rounded-lg p-3">
          <div className="text-sm font-medium text-gray-300 mb-2">Events by Status</div>
          <div className="flex gap-4 text-sm">
            <span><span className="text-green-400 font-bold">{data.stats.liveEvents}</span> Live</span>
            <span><span className="text-blue-400 font-bold">{data.stats.preEvents}</span> Pre</span>
          </div>
        </div>
        <div className="bg-gray-900/30 rounded-lg p-3">
          <div className="text-sm font-medium text-gray-300 mb-2">Events by Platform</div>
          <div className="flex gap-4 text-sm">
            <span className="text-orange-300">{data.eventsByPlatform?.sxbet || 0} SX</span>
            <span className="text-purple-300">{data.eventsByPlatform?.polymarket || 0} Poly</span>
            <span className="text-blue-300">{data.eventsByPlatform?.kalshi || 0} Kalshi</span>
          </div>
        </div>
      </div>

      {/* Match Quality */}
      {data.matcher && (
        <div className="bg-gray-900/30 rounded-lg p-3 mb-4">
          <div className="text-sm font-medium text-gray-300 mb-2">Match Quality</div>
          <div className="flex gap-4 text-sm">
            <span>
              <span className="text-green-400 font-bold">{data.matcher.threeWayMatches}</span> 3-way matches
              {data.matcher.threeWayMatches > 0 && ' 🎯'}
            </span>
            <span>
              <span className="text-yellow-400 font-bold">{data.matcher.twoWayMatches}</span> 2-way matches
            </span>
          </div>
        </div>
      )}

      {/* Config Summary */}
      {data.config && (
        <div className="border-t border-gray-700 pt-3 text-xs text-gray-500">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Time tolerance: {data.config.timeToleranceMinutes}min</span>
            <span>Max watchers: {data.config.maxWatchers}</span>
            <span>Min platforms: {data.config.minPlatforms}</span>
            {uptimeMinutes > 0 && <span>Uptime: {uptimeMinutes}min</span>}
          </div>
        </div>
      )}

      {/* Watcher Performance */}
      {data.watchers?.stats && data.stats.arbChecksTotal > 0 && (
        <div className="border-t border-gray-700 pt-3 mt-3 text-xs text-gray-500">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Arb checks: {data.stats.arbChecksTotal}</span>
            <span>Avg check: {data.watchers.stats.avgCheckTimeMs?.toFixed(1) || 0}ms</span>
            <span>Max check: {data.watchers.stats.maxCheckTimeMs || 0}ms</span>
            <span>Markets: {data.watchers.stats.totalMarketsWatched || 0}</span>
          </div>
        </div>
      )}

      {/* Debug Panel - Always available, especially useful when 0 groups */}
      <MatcherDebugPanel debug={data.debug} snapshotAge={data.snapshotAge} />
    </div>
  );
}

// Matched Events Table
function MatchedEventsTable({ groups }: { groups: MatchedEventGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="p-8 text-center text-gray-400">
        No matched events yet. The matcher looks for the same sporting event across multiple platforms.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-900/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Event</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Sport</th>
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Status</th>
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Platforms</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Quality</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {groups.slice(0, 20).map((group) => (
            <tr key={group.eventKey} className="hover:bg-gray-700/30">
              <td className="px-4 py-3 text-sm text-gray-200">
                {group.homeTeam && group.awayTeam 
                  ? `${group.homeTeam} vs ${group.awayTeam}`
                  : group.eventKey}
              </td>
              <td className="px-4 py-3 text-sm">
                <span className="px-2 py-1 rounded text-xs font-medium bg-cyan-900/30 text-cyan-300">
                  {group.sport}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  group.status === 'LIVE' 
                    ? 'bg-green-900/30 text-green-300' 
                    : 'bg-gray-700 text-gray-400'
                }`}>
                  {group.status}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <div className="flex justify-center gap-1">
                  {Object.keys(group.vendors).map(platform => (
                    <span key={platform} className={`px-2 py-1 rounded text-xs font-medium ${
                      platform === 'SXBET' ? 'bg-orange-900/30 text-orange-300' :
                      platform === 'POLYMARKET' ? 'bg-purple-900/30 text-purple-300' :
                      'bg-blue-900/30 text-blue-300'
                    }`}>
                      {platform}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-right text-gray-400">
                {(group.matchQuality * 100).toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Execution Mode Toggle
function ExecutionModeCard({
  executionMode,
  onToggle,
  isLoading,
}: {
  executionMode: ExecutionModeData | null;
  onToggle: (newMode: 'DRY_FIRE' | 'LIVE') => void;
  isLoading: boolean;
}) {
  if (!executionMode) {
    return (
      <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
          Execution Mode
        </h3>
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  const isDryFire = executionMode.mode === 'DRY_FIRE';

  return (
    <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
          Execution Mode
        </h3>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
          isDryFire 
            ? 'bg-amber-900/30 text-amber-300 border border-amber-700/50' 
            : 'bg-green-900/30 text-green-300 border border-green-700/50'
        }`}>
          {executionMode.mode}
        </span>
      </div>

      {/* Toggle buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onToggle('DRY_FIRE')}
          disabled={isLoading || isDryFire}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            isDryFire
              ? 'bg-amber-600 text-white cursor-default'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <FileText className="w-4 h-4" />
          Dry-Fire
        </button>

        <button
          onClick={() => onToggle('LIVE')}
          disabled={isLoading || !isDryFire}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            !isDryFire
              ? 'bg-green-600 text-white cursor-default'
              : 'bg-gray-700 text-gray-300 hover:bg-green-600 hover:text-white'
          }`}
        >
          <Zap className="w-4 h-4" />
          Live
        </button>
      </div>

      {/* Status text */}
      <div className="mt-4 text-sm">
        {isDryFire ? (
          <p className="text-amber-300/80">
            📝 Simulating orders only. No real bets are placed.
          </p>
        ) : (
          <p className="text-green-300/80">
            ⚡ Live trading enabled. Orders may be placed on connected platforms.
          </p>
        )}
      </div>
    </div>
  );
}

// CSV Export Panel
function ExportPanel() {
  const [isExporting, setIsExporting] = useState(false);
  const [exportType, setExportType] = useState<'all' | 'simulated' | 'rejected'>('all');

  const handleExport = async () => {
    setIsExporting(true);
    try {
      let url = '/api/live-arb/dry-fire-export';
      if (exportType === 'simulated') {
        url += '?status=SIMULATED';
      } else if (exportType === 'rejected') {
        url += '?status=REJECTED_BY_SAFETY';
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `dry-fire-trades-${exportType}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export CSV');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
      <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
        <Download className="w-5 h-5 text-purple-400" />
        Export Dry-Fire Trades
      </h3>

      <div className="flex flex-wrap items-center gap-4">
        <select
          value={exportType}
          onChange={(e) => setExportType(e.target.value as any)}
          className="bg-gray-700 text-gray-200 rounded-lg px-4 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
        >
          <option value="all">All Trades</option>
          <option value="simulated">Simulated Only</option>
          <option value="rejected">Rejected Only</option>
        </select>

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 
                     disabled:bg-purple-800 disabled:cursor-not-allowed rounded-lg text-white font-medium"
        >
          {isExporting ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Download CSV
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// Main component
export default function LiveArbPage() {
  const [liveArbStatus, setLiveArbStatus] = useState<LiveArbStatus | null>(null);
  const [dryFireStats, setDryFireStats] = useState<DryFireStats | null>(null);
  const [marketsData, setMarketsData] = useState<LiveMarketsResponse | null>(null);
  const [liveEventsData, setLiveEventsData] = useState<LiveEventsData | null>(null);
  const [executionMode, setExecutionMode] = useState<ExecutionModeData | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<LiveArbRuntimeConfigData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [botActionLoading, setBotActionLoading] = useState(false);
  const [executionModeLoading, setExecutionModeLoading] = useState(false);

  // Fetch /api/live-arb/status snapshot (worker + runtime info)
  const fetchLiveArbStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/live-arb/status');
      if (!res.ok) throw new Error('Failed to fetch live-arb status');
      const data = await res.json();
      setLiveArbStatus(data);
      if (data.runtimeConfig) {
        setRuntimeConfig(data.runtimeConfig);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch live-arb status');
    }
  }, []);

  // Fetch dry-fire stats
  const fetchDryFireStats = async () => {
    try {
      const res = await fetch('/api/live-arb/dry-fire-stats');
      if (!res.ok) throw new Error('Failed to fetch dry-fire stats');
      const data = await res.json();
      setDryFireStats(data);
    } catch (err: any) {
      console.error('Failed to fetch dry-fire stats:', err);
    }
  };

  // Fetch markets (KV-backed watched markets, not live prices)
  const fetchMarkets = async () => {
    try {
      const res = await fetch('/api/live-arb/markets?limit=50');
      if (!res.ok) throw new Error('Failed to fetch markets');
      const data: LiveMarketsResponse = await res.json();
      setMarketsData(data);
    } catch (err: any) {
      console.error('Failed to fetch markets:', err);
    }
  };

  // Fetch live events (rule-based matcher)
  const fetchLiveEvents = async () => {
    try {
      const res = await fetch('/api/live-arb/live-events');
      if (!res.ok) throw new Error('Failed to fetch live events');
      const data = await res.json();
      setLiveEventsData(data);
    } catch (err: any) {
      console.error('Failed to fetch live events:', err);
    }
  };

  // Fetch execution mode
  const fetchExecutionMode = async () => {
    try {
      const res = await fetch('/api/live-arb/execution-mode');
      if (!res.ok) throw new Error('Failed to fetch execution mode');
      const data = await res.json();
      setExecutionMode(data);
    } catch (err: any) {
      console.error('Failed to fetch execution mode:', err);
    }
  };

  const fetchRuntimeConfig = async () => {
    try {
      const res = await fetch('/api/live-arb/config');
      if (!res.ok) throw new Error('Failed to fetch live-arb runtime config');
      const data = await res.json();
      setRuntimeConfig(data);
    } catch (err: any) {
      console.error('Failed to fetch live-arb config:', err);
    }
  };

  const updateLiveArbConfig = useCallback(
    async (patch: Partial<LiveArbRuntimeConfigData>) => {
      const res = await fetch('/api/live-arb/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Failed to update live-arb config');
      }

      const data = await res.json();
      setRuntimeConfig(data);
      setLiveArbStatus((prev) =>
        prev
          ? {
              ...prev,
              runtimeConfig: data,
              liveArbEnabled: data.liveArbEnabled,
            }
          : prev
      );
      return data;
    },
    []
  );

  // Toggle execution mode
  const toggleExecutionMode = useCallback(async (newMode: 'DRY_FIRE' | 'LIVE') => {
    setExecutionModeLoading(true);
    try {
      const res = await fetch('/api/live-arb/execution-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to change mode');
      }
      
      await fetchExecutionMode();
    } catch (err: any) {
      console.error('Failed to change execution mode:', err);
      alert('Failed to change execution mode: ' + err.message);
    } finally {
      setExecutionModeLoading(false);
    }
  }, []);

  // Start bot
  const startBot = async () => {
    setBotActionLoading(true);
    try {
      await updateLiveArbConfig({
        liveArbEnabled: true,
        ruleBasedMatcherEnabled: true,
      });
      await fetchLiveArbStatus();
    } catch (err: any) {
      console.error('Failed to start bot:', err);
      alert('Failed to start bot: ' + err.message);
    } finally {
      setBotActionLoading(false);
    }
  };

  // Stop bot
  const stopBot = async () => {
    setBotActionLoading(true);
    try {
      await updateLiveArbConfig({ liveArbEnabled: false });
      await fetchLiveArbStatus();
    } catch (err: any) {
      console.error('Failed to stop bot:', err);
      alert('Failed to stop bot: ' + err.message);
    } finally {
      setBotActionLoading(false);
    }
  };

  // Refresh all
  const refresh = async () => {
    setIsLoading(true);
    await Promise.all([
      fetchLiveArbStatus(), 
      fetchMarkets(),
      fetchDryFireStats(),
      fetchLiveEvents(),
      fetchExecutionMode(),
      fetchRuntimeConfig(),
    ]);
    setLastRefresh(new Date());
    setIsLoading(false);
  };

  // Initial load and auto-refresh
  useEffect(() => {
    refresh();
    
    // Auto-refresh every 5 seconds
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  const liveArbEnabledFlag =
    runtimeConfig?.liveArbEnabled ??
    liveArbStatus?.runtimeConfig?.liveArbEnabled ??
    false;
  const workerPresent = liveArbStatus?.workerPresent ?? false;
  const workerState = liveArbStatus?.workerState ?? null;
  const workerHeartbeatAt = liveArbStatus?.workerHeartbeatAt ?? null;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Live Arbitrage Monitor</h1>
            <p className="text-gray-400 text-sm mt-1">
              Real-time WebSocket connections, live price data, and bot controls
            </p>
          </div>
          <div className="flex items-center gap-4">
            {lastRefresh && (
              <span className="text-sm text-gray-400">
                Updated {formatTimeAgo(lastRefresh.toISOString())}
              </span>
            )}
            <button
              onClick={refresh}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 
                         disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-white"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-700/50 rounded-lg text-red-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* KV Status Banner - shows when there are KV connectivity issues */}
        {liveArbStatus && (
          <KVStatusBanner 
            kvStatus={liveArbStatus.kvStatus} 
            kvStatusReason={liveArbStatus.kvStatusReason} 
          />
        )}

        {/* Execution Mode Control */}
        <div className="mb-6">
          <ExecutionModeCard
            executionMode={executionMode}
            onToggle={toggleExecutionMode}
            isLoading={executionModeLoading}
          />
        </div>

        {/* Bot Control + Export Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <BotControlPanel
            liveArbEnabled={liveArbEnabledFlag}
            workerPresent={workerPresent}
            workerState={workerState}
            workerHeartbeatAt={workerHeartbeatAt}
            executionMode={executionMode}
            onStart={startBot}
            onStop={stopBot}
            isLoading={botActionLoading}
          />
          <ExportPanel />
        </div>

        {/* Dry Fire Stats */}
        {dryFireStats && <div className="mb-6"><DryFireStatsCard stats={dryFireStats} /></div>}

        {/* Rule-Based Sports Matcher */}
        <div className="mb-6">
          <RuleBasedMatcherCard
            data={liveEventsData}
            runtimeConfig={runtimeConfig}
          />
        </div>

        {/* Overall Status */}
        {liveArbStatus && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* System Status Card */}
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 mb-2">System Status</h3>
              <div className="flex items-center gap-3">
                {liveArbStatus.liveArbEnabled ? (
                  liveArbStatus.liveArbReady ? (
                    <>
                      <CheckCircle className="w-8 h-8 text-green-400" />
                      <div>
                        <div className="text-lg font-semibold text-green-400">Ready</div>
                        <div className="text-sm text-gray-400">Live arb active</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-8 h-8 text-yellow-400" />
                      <div>
                        <div className="text-lg font-semibold text-yellow-400">Degraded</div>
                        <div className="text-sm text-gray-400">Enabled but not ready</div>
                      </div>
                    </>
                  )
                ) : (
                  <>
                    <XCircle className="w-8 h-8 text-gray-500" />
                    <div>
                      <div className="text-lg font-semibold text-gray-400">Disabled</div>
                      <div className="text-sm text-gray-500">Enable via Live Arb Controls</div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Price Cache Card */}
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Price Cache</h3>
              <div className="text-2xl font-bold text-white">
                {liveArbStatus.priceCacheStats.totalEntries}
              </div>
              <div className="text-sm text-gray-400">cached prices</div>
              <div className="mt-2 text-xs text-gray-500">
                {liveArbStatus.priceCacheStats.totalPriceUpdates.toLocaleString()} total updates
              </div>
            </div>

            {/* Circuit Breaker Card */}
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Circuit Breaker</h3>
              {liveArbStatus.circuitBreaker.isOpen ? (
                <div className="flex items-center gap-2 text-red-400">
                  <AlertTriangle className="w-6 h-6" />
                  <div>
                    <div className="font-semibold">OPEN</div>
                    <div className="text-xs text-gray-400">
                      {liveArbStatus.circuitBreaker.openReason}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle className="w-6 h-6" />
                  <div>
                    <div className="font-semibold">Closed</div>
                    <div className="text-xs text-gray-400">
                      {liveArbStatus.circuitBreaker.consecutiveFailures} recent failures
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Platform Status Cards with Staleness Detection */}
        {liveArbStatus && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white mb-3">Platform Connections</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <PlatformCard 
                name="SX.bet" 
                status={liveArbStatus.platforms.sxbet}
                isStale={liveArbStatus.platforms.sxbet.isStale}
              />
              <PlatformCard 
                name="Polymarket" 
                status={liveArbStatus.platforms.polymarket}
                isStale={liveArbStatus.platforms.polymarket.isStale}
              />
              <PlatformCard 
                name="Kalshi" 
                status={liveArbStatus.platforms.kalshi}
                isStale={liveArbStatus.platforms.kalshi.isStale}
              />
            </div>
          </div>
        )}

        {/* Watched Markets Table (KV-backed) */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Live Markets</h2>
                <p className="text-sm text-gray-400">
                  Markets being watched by the Digital Ocean worker
                </p>
              </div>
              {marketsData && (
                <div className="text-right text-sm">
                  <div className="text-gray-400">
                    {marketsData.priceCacheStats.totalEntries} prices cached
                  </div>
                  {marketsData.snapshotUpdatedAt && (
                    <div className="text-gray-500 text-xs">
                      Snapshot: {formatTimeAgo(marketsData.snapshotUpdatedAt)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Architecture notice when no data */}
          {marketsData?.notice && (
            <div className="px-4 py-3 bg-blue-900/20 border-b border-blue-700/30">
              <div className="flex items-start gap-2 text-sm text-blue-300">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{marketsData.notice}</span>
              </div>
            </div>
          )}

          {/* Stale platform warning - use status API's computed isStale */}
          {(liveArbStatus?.platforms.sxbet.isStale || 
            liveArbStatus?.platforms.polymarket.isStale || 
            liveArbStatus?.platforms.kalshi.isStale) && (
            <div className="px-4 py-3 bg-orange-900/20 border-b border-orange-700/30">
              <div className="flex items-start gap-2 text-sm text-orange-300">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  Some platforms have stale connections (no message in &gt;60s). 
                  Check WebSocket health on the Digital Ocean worker.
                </span>
              </div>
            </div>
          )}

          {(!marketsData || marketsData.watchedMarkets.length === 0) ? (
            <div className="p-8 text-center">
              <div className="text-gray-400 mb-2">
                {!marketsData?.workerPresent 
                  ? 'Worker is not running. Start the Digital Ocean worker to begin monitoring.'
                  : 'No markets are currently being watched.'}
              </div>
              <div className="text-gray-500 text-sm">
                The worker maintains live prices in-memory. This dashboard shows which markets are being monitored.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Platform
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Event
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Sport
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Market ID
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {marketsData.watchedMarkets.map((market) => (
                    <tr key={market.id} className="hover:bg-gray-700/30">
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded text-xs font-medium 
                          ${market.platform === 'sxbet' ? 'bg-orange-900/30 text-orange-300' :
                            market.platform === 'polymarket' ? 'bg-purple-900/30 text-purple-300' :
                            'bg-blue-900/30 text-blue-300'}`}>
                          {market.platform}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-200">
                        {market.homeTeam && market.awayTeam 
                          ? `${market.homeTeam} vs ${market.awayTeam}`
                          : market.rawTitle.substring(0, 40)}
                        {market.rawTitle.length > 40 && '...'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="px-2 py-1 rounded text-xs font-medium bg-cyan-900/30 text-cyan-300">
                          {market.sport}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          market.status === 'LIVE' 
                            ? 'bg-green-900/30 text-green-300' 
                            : market.status === 'PRE'
                              ? 'bg-gray-700 text-gray-400'
                              : 'bg-red-900/30 text-red-300'
                        }`}>
                          {market.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400 font-mono">
                        {market.vendorMarketId.substring(0, 16)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {/* Summary footer */}
              <div className="px-4 py-3 bg-gray-900/30 border-t border-gray-700 text-sm text-gray-400">
                Showing {marketsData.watchedMarkets.length} of {marketsData.totalWatchedMarkets} watched markets
                {marketsData.filteredCount !== marketsData.totalWatchedMarkets && 
                  ` (${marketsData.filteredCount} after filters)`}
              </div>
            </div>
          )}
        </div>

        {/* Matched Events Table (Rule-Based Matcher) */}
        {liveEventsData && liveEventsData.matchedGroups.length > 0 && (
          <div className="mt-6 bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">Matched Events (Rule-Based)</h2>
              <p className="text-sm text-gray-400">
                Same sporting events matched across platforms - {liveEventsData.matchedGroups.length} groups found
              </p>
            </div>
            <MatchedEventsTable groups={liveEventsData.matchedGroups} />
          </div>
        )}

        {/* Blocked Opportunities Stats */}
        {liveArbStatus && liveArbStatus.subscriptionStats.blockedOpportunities > 0 && (
          <div className="mt-6 bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-sm font-medium text-gray-400 mb-3">
              Blocked Opportunities ({liveArbStatus.subscriptionStats.blockedOpportunities})
            </h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(liveArbStatus.subscriptionStats.blockedReasons).map(([reason, count]) => (
                <span key={reason} className="px-3 py-1 bg-red-900/20 border border-red-700/50 
                                               rounded text-sm text-red-300">
                  {reason}: {count}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
