import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import StatsCard from '@/components/StatsCard';
import ProfitChart from '@/components/ProfitChart';
import BetsTable from '@/components/BetsTable';
import ConfigPanel from '@/components/ConfigPanel';
import { Bet, DailyStats, AccountBalance } from '@/types';
import { TrendingUp, Activity, Wallet, RefreshCw } from 'lucide-react';

interface BotHealth {
  healthy: boolean;
  running: boolean;
  lastScan?: string;
  lastSuccessfulScan?: string;
  minutesSinceLastScan?: number;
  consecutiveErrors: number;
  totalScans: number;
  totalErrors: number;
  watchdogLastRun?: string;
  minutesSinceWatchdog?: number;
  restartAttempts: number;
  restartThrottled: boolean;
  lastRestartReason?: string;
  lastScanDurationMs?: number;
  averageScanDurationMs?: number;
  healthReasons: string[];
}

export default function DashboardPage() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [botRunning, setBotRunning] = useState(false);
  const [botHealth, setBotHealth] = useState<BotHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPeriod, setExportPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('weekly');
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');

  useEffect(() => {
    // Load data on mount
    fetchData();
    
    // Refresh data every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [betsRes, statsRes, balancesRes, statusRes] = await Promise.all([
        fetch('/api/bets'),
        fetch('/api/stats'),
        fetch('/api/balances'),
        fetch('/api/bot/status'),
      ]);

      const betsData = await betsRes.json();
      const statsData = await statsRes.json();
      const balancesData = await balancesRes.json();
      const statusData = await statusRes.json();

      setBets(betsData.bets || []);
      setDailyStats(statsData.stats || []);
      setBalances(balancesData.balances || []);
      setBotRunning(statusData.running || false);
      setBotHealth(statusData);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoading(false);
    }
  };

  const handleBotToggle = async () => {
    try {
      const action = botRunning ? 'stop' : 'start';
      const response = await fetch('/api/bot/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (response.ok) {
        setBotRunning(!botRunning);
      }
    } catch (error) {
      console.error('Error toggling bot:', error);
    }
  };

  const handleRefreshBalances = async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/balances/refresh', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Balances refreshed:', data);
        // Refresh the dashboard data
        await fetchData();
      } else {
        console.error('Failed to refresh balances');
      }
    } catch (error) {
      console.error('Error refreshing balances:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: exportPeriod, format: exportFormat }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `algobet-export-${exportPeriod}.${exportFormat}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Error exporting data:', error);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Calculate stats
  const totalProfit = dailyStats.reduce((sum, stat) => sum + stat.totalProfit, 0);
  const activeBetsCount = bets.filter((b) => b.status === 'filled' || b.status === 'pending').length;
  const resolvedBetsCount = bets.filter((b) => b.status === 'resolved').length;
  
  // Get balance details (total, cash, positions)
  const kalshiBalanceData = balances.find(b => b.platform === 'kalshi');
  const polymarketBalanceData = balances.find(b => b.platform === 'polymarket');
  const sxbetBalanceData = balances.find(b => b.platform === 'sxbet');
  
  const kalshiBalance = kalshiBalanceData?.balance || 0;
  const kalshiCash = kalshiBalanceData?.availableCash ?? 0;
  
  const polymarketBalance = polymarketBalanceData?.balance || 0;
  const polymarketCash = polymarketBalanceData?.availableCash ?? 0;
  
  const sxbetBalance = sxbetBalanceData?.balance || 0;
  const totalBalance = kalshiBalance + polymarketBalance + sxbetBalance;
  const totalCash = kalshiCash + polymarketCash + sxbetBalance;

  // Debug logs to verify data flow [UPDATED]
  console.log('Dashboard Balance Data [FIXED]:', {
    kalshi: { total: kalshiBalance, cash: kalshiCash },
    polymarket: { total: polymarketBalance, cash: polymarketCash },
    sxbet: { total: sxbetBalance, cash: sxbetBalance },
    total: { total: totalBalance, cash: totalCash }
  });

  const avgDailyProfit = dailyStats.length > 0
    ? dailyStats.reduce((sum, stat) => sum + stat.totalProfit, 0) / dailyStats.length
    : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header with Bot Control */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-600 mt-1">Monitor your arbitrage trading bot</p>
            {botHealth && botRunning && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center space-x-4 text-sm">
                  <div className={`flex items-center ${botHealth.healthy ? 'text-green-600' : 'text-red-600'}`}>
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${botHealth.healthy ? 'bg-green-600' : 'bg-red-600'} animate-pulse`}></span>
                    {botHealth.healthy ? 'Healthy' : 'Unhealthy'}
                  </div>
                  <span className="text-gray-500">•</span>
                  <span className="text-gray-600">
                    {botHealth.totalScans} scans
                  </span>
                  {botHealth.minutesSinceLastScan !== undefined && (
                    <>
                      <span className="text-gray-500">•</span>
                      <span className="text-gray-600">
                        Last: {botHealth.minutesSinceLastScan}m ago
                      </span>
                    </>
                  )}
                  {botHealth.averageScanDurationMs && (
                    <>
                      <span className="text-gray-500">•</span>
                      <span className="text-gray-600">
                        Avg: {(botHealth.averageScanDurationMs / 1000).toFixed(1)}s
                      </span>
                    </>
                  )}
                </div>
                {!botHealth.healthy && botHealth.healthReasons && botHealth.healthReasons.length > 0 && (
                  <div className="text-xs text-red-600">
                    {botHealth.healthReasons.join(' • ')}
                  </div>
                )}
                {botHealth.restartThrottled && (
                  <div className="text-xs text-orange-600">
                    ⚠️ Restart throttled ({botHealth.restartAttempts}/3 restarts in last hour)
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={handleRefreshBalances}
              disabled={refreshing}
              className="px-4 py-3 rounded-lg font-semibold transition-colors bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh Balances'}</span>
            </button>
            <button
              onClick={handleBotToggle}
              className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                botRunning
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {botRunning ? '⏸ Stop Bot' : '▶ Start Bot'}
            </button>
            <div
              className={`px-4 py-2 rounded-lg font-medium ${
                botRunning ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
              }`}
            >
              {botRunning ? '🟢 Running' : '🔴 Stopped'}
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <StatsCard
              title="Total Profit"
              value={`$${totalProfit.toFixed(2)}`}
              change={`Avg daily: $${avgDailyProfit.toFixed(2)}`}
              icon={TrendingUp}
              color="green"
              trend={totalProfit > 0 ? 'up' : totalProfit < 0 ? 'down' : 'neutral'}
            />
            <StatsCard
              title="Active Bets"
              value={activeBetsCount}
              change={`${resolvedBetsCount} resolved`}
              icon={Activity}
              color="blue"
            />
            <StatsCard
              title="Total Balance"
              value={`$${totalBalance.toFixed(2)}`}
              change={`Cash: $${totalCash.toFixed(2)}`}
              icon={Wallet}
              color="yellow"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <StatsCard
              title="Kalshi Balance"
              value={`$${kalshiBalance.toFixed(2)}`}
              change={`Cash: $${kalshiCash.toFixed(2)}`}
              icon={Wallet}
              color="purple"
            />
            <StatsCard
              title="Polymarket Balance"
              value={`$${polymarketBalance.toFixed(2)}`}
              change={`Cash: $${polymarketCash.toFixed(2)}`}
              icon={Wallet}
              color="blue"
            />
            <StatsCard
              title="SxBet Balance"
              value={`$${sxbetBalance.toFixed(2)}`}
              change={`Cash: $${sxbetBalance.toFixed(2)}`}
              icon={Wallet}
              color="green"
            />
          </div>
        </div>

        {/* Profit Chart */}
        {dailyStats.length > 0 && (
          <ProfitChart 
            data={dailyStats.map(stat => ({ 
              date: stat.date, 
              profit: stat.totalProfit 
            }))} 
          />
        )}

        {/* Export Section */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Export Data</h2>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Period</label>
              <select
                value={exportPeriod}
                onChange={(e) => setExportPeriod(e.target.value as any)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Format</label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as any)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {exporting ? 'Exporting...' : '📥 Export'}
            </button>
          </div>
        </div>

        {/* Configuration Panel */}
        <ConfigPanel onUpdate={fetchData} />

        {/* Bets Table */}
        <BetsTable bets={bets} />
      </div>
    </DashboardLayout>
  );
}

