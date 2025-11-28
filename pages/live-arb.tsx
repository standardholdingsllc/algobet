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

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { 
  RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle, XCircle,
  Play, Square, Download, FileText, TrendingUp, Activity
} from 'lucide-react';

// Types
interface PlatformStatus {
  connected: boolean;
  state: string;
  lastMessageAt: string | null;
  subscribedMarkets: number;
  errorMessage?: string;
}

interface LiveArbStatus {
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

interface LiveMarket {
  id: string;
  displayTitle: string;
  isLive: boolean;
  platforms: {
    platform: string;
    marketId: string;
    yesPrice?: number;
    noPrice?: number;
    priceSource: string;
    priceAgeMs?: number;
  }[];
}

interface LiveMarketsResponse {
  markets: LiveMarket[];
  totalCount: number;
  filteredCount: number;
}

interface BotStatus {
  isRunning: boolean;
  lastScanAt?: string;
  opportunitiesFound?: number;
  mode: 'DRY_FIRE' | 'LIVE' | 'SIMULATION';
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

interface LiveEventsData {
  enabled: boolean;
  running: boolean;
  uptimeMs: number;
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
}

// Status indicator component
function StatusIndicator({ connected }: { connected: boolean }) {
  return connected ? (
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

// Platform card component
function PlatformCard({
  name,
  status,
}: {
  name: string;
  status: PlatformStatus;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white capitalize">{name}</h3>
        <StatusIndicator connected={status.connected} />
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">State</span>
          <span className="text-gray-200">{status.state}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Subscribed Markets</span>
          <span className="text-gray-200">{status.subscribedMarkets}</span>
        </div>
        {status.lastMessageAt && (
          <div className="flex justify-between">
            <span className="text-gray-400">Last Message</span>
            <span className="text-gray-200">
              {formatTimeAgo(status.lastMessageAt)}
            </span>
          </div>
        )}
        {status.errorMessage && (
          <div className="mt-2 p-2 bg-red-900/20 border border-red-700/50 rounded text-red-300 text-xs">
            {status.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
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
function BotControlPanel({ 
  botStatus, 
  onStart, 
  onStop,
  isLoading 
}: { 
  botStatus: BotStatus | null;
  onStart: () => void;
  onStop: () => void;
  isLoading: boolean;
}) {
  const isDryFire = botStatus?.mode === 'DRY_FIRE';
  
  return (
    <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          Live Betting Bot
        </h3>
        {botStatus && (
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            botStatus.isRunning 
              ? 'bg-green-900/30 text-green-300 border border-green-700/50' 
              : 'bg-gray-700 text-gray-400'
          }`}>
            {botStatus.isRunning ? 'RUNNING' : 'STOPPED'}
          </span>
        )}
      </div>

      {isDryFire && (
        <div className="mb-4 p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg">
          <div className="flex items-center gap-2 text-amber-300 text-sm">
            <AlertTriangle className="w-4 h-4" />
            <span>Dry-fire mode is active. No real orders will be placed.</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={onStart}
          disabled={isLoading || botStatus?.isRunning}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            botStatus?.isRunning
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
          disabled={isLoading || !botStatus?.isRunning}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            !botStatus?.isRunning
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          <Square className="w-4 h-4" />
          Stop Bot
        </button>
      </div>

      {botStatus?.lastScanAt && (
        <div className="mt-4 pt-4 border-t border-gray-700 text-sm text-gray-400">
          <div className="flex justify-between">
            <span>Last Scan</span>
            <span>{formatTimeAgo(botStatus.lastScanAt)}</span>
          </div>
          {botStatus.opportunitiesFound !== undefined && (
            <div className="flex justify-between mt-1">
              <span>Opportunities Found</span>
              <span className="text-green-400">{botStatus.opportunitiesFound}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Rule-Based Matcher Card
function RuleBasedMatcherCard({ data }: { data: LiveEventsData | null }) {
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

  const uptimeMinutes = Math.floor((data.uptimeMs || 0) / 60000);

  return (
    <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          Rule-Based Sports Matcher
        </h3>
        <div className="flex items-center gap-2">
          {data.running && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-green-900/30 text-green-300">
              RUNNING
            </span>
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            data.enabled 
              ? 'bg-cyan-900/30 text-cyan-300 border border-cyan-700/50' 
              : 'bg-gray-700 text-gray-400'
          }`}>
            {data.enabled ? 'ENABLED' : 'DISABLED'}
          </span>
        </div>
      </div>

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
  const [status, setStatus] = useState<LiveArbStatus | null>(null);
  const [dryFireStats, setDryFireStats] = useState<DryFireStats | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [markets, setMarkets] = useState<LiveMarket[]>([]);
  const [liveEventsData, setLiveEventsData] = useState<LiveEventsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [botActionLoading, setBotActionLoading] = useState(false);

  // Fetch status
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/live-arb/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

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

  // Fetch bot status
  const fetchBotStatus = async () => {
    try {
      const res = await fetch('/api/bot/status');
      if (!res.ok) throw new Error('Failed to fetch bot status');
      const data = await res.json();
      setBotStatus({
        isRunning: Boolean(
          data.running ??
          data.isScanning ??
          (typeof data.status === 'string' ? data.status === 'running' : data.status?.running)
        ),
        lastScanAt: data.lastScan || data.lastSuccessfulScan || data.lastUpdated,
        opportunitiesFound: data.lastScanOpportunities ?? data.opportunitiesFound,
        mode: process.env.NEXT_PUBLIC_DRY_FIRE_MODE === 'true'
          ? 'DRY_FIRE'
          : data.simulationMode
            ? 'SIMULATION'
            : 'LIVE',
      });
    } catch (err: any) {
      console.error('Failed to fetch bot status:', err);
    }
  };

  // Fetch markets
  const fetchMarkets = async () => {
    try {
      const res = await fetch('/api/live-arb/markets?limit=20');
      if (!res.ok) throw new Error('Failed to fetch markets');
      const data: LiveMarketsResponse = await res.json();
      setMarkets(data.markets);
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

  // Start bot
  const startBot = async () => {
    setBotActionLoading(true);
    try {
      const res = await fetch('/api/bot/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      if (!res.ok) throw new Error('Failed to start bot');
      await fetchBotStatus();
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
      const res = await fetch('/api/bot/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      if (!res.ok) throw new Error('Failed to stop bot');
      await fetchBotStatus();
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
      fetchStatus(), 
      fetchMarkets(),
      fetchDryFireStats(),
      fetchBotStatus(),
      fetchLiveEvents(),
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

        {/* Bot Control + Dry Fire Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <BotControlPanel
            botStatus={botStatus}
            onStart={startBot}
            onStop={stopBot}
            isLoading={botActionLoading}
          />
          <ExportPanel />
        </div>

        {/* Dry Fire Stats */}
        {dryFireStats && <div className="mb-6"><DryFireStatsCard stats={dryFireStats} /></div>}

        {/* Rule-Based Sports Matcher */}
        <div className="mb-6"><RuleBasedMatcherCard data={liveEventsData} /></div>

        {/* Overall Status */}
        {status && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* System Status Card */}
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 mb-2">System Status</h3>
              <div className="flex items-center gap-3">
                {status.liveArbEnabled ? (
                  status.liveArbReady ? (
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
                      <div className="text-sm text-gray-500">Set LIVE_ARB_ENABLED=true</div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Price Cache Card */}
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Price Cache</h3>
              <div className="text-2xl font-bold text-white">
                {status.priceCacheStats.totalEntries}
              </div>
              <div className="text-sm text-gray-400">cached prices</div>
              <div className="mt-2 text-xs text-gray-500">
                {status.priceCacheStats.totalPriceUpdates.toLocaleString()} total updates
              </div>
            </div>

            {/* Circuit Breaker Card */}
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Circuit Breaker</h3>
              {status.circuitBreaker.isOpen ? (
                <div className="flex items-center gap-2 text-red-400">
                  <AlertTriangle className="w-6 h-6" />
                  <div>
                    <div className="font-semibold">OPEN</div>
                    <div className="text-xs text-gray-400">
                      {status.circuitBreaker.openReason}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle className="w-6 h-6" />
                  <div>
                    <div className="font-semibold">Closed</div>
                    <div className="text-xs text-gray-400">
                      {status.circuitBreaker.consecutiveFailures} recent failures
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Platform Status Cards */}
        {status && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white mb-3">Platform Connections</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <PlatformCard name="SX.bet" status={status.platforms.sxbet} />
              <PlatformCard name="Polymarket" status={status.platforms.polymarket} />
              <PlatformCard name="Kalshi" status={status.platforms.kalshi} />
            </div>
          </div>
        )}

        {/* Live Markets Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">Live Markets</h2>
            <p className="text-sm text-gray-400">Markets with cached live prices</p>
          </div>

          {markets.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              No live price data available. Check WebSocket connections.
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
                      Market ID
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">
                      Yes Price
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">
                      No Price
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">
                      Age
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {markets.map((market) => (
                    market.platforms.map((p, idx) => (
                      <tr key={`${market.id}-${idx}`} className="hover:bg-gray-700/30">
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded text-xs font-medium 
                            ${p.platform === 'sxbet' ? 'bg-orange-900/30 text-orange-300' :
                              p.platform === 'polymarket' ? 'bg-purple-900/30 text-purple-300' :
                              'bg-blue-900/30 text-blue-300'}`}>
                            {p.platform}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 font-mono">
                          {p.marketId.substring(0, 20)}...
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-green-400">
                          {p.yesPrice !== undefined ? p.yesPrice.toFixed(2) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-red-400">
                          {p.noPrice !== undefined ? p.noPrice.toFixed(2) : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {market.isLive ? (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-green-900/30 text-green-300">
                              LIVE
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-700 text-gray-400">
                              Pre
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-400">
                          {p.priceAgeMs !== undefined ? `${(p.priceAgeMs / 1000).toFixed(1)}s` : '-'}
                        </td>
                      </tr>
                    ))
                  ))}
                </tbody>
              </table>
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
        {status && status.subscriptionStats.blockedOpportunities > 0 && (
          <div className="mt-6 bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-sm font-medium text-gray-400 mb-3">
              Blocked Opportunities ({status.subscriptionStats.blockedOpportunities})
            </h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(status.subscriptionStats.blockedReasons).map(([reason, count]) => (
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
