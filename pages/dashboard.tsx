import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import StatsCard from '@/components/StatsCard';
import ProfitChart from '@/components/ProfitChart';
import BetsTable from '@/components/BetsTable';
import ConfigPanel from '@/components/ConfigPanel';
import { Bet, DailyStats, AccountBalance } from '@/types';
import { TrendingUp, Activity, Wallet } from 'lucide-react';

export default function DashboardPage() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [botRunning, setBotRunning] = useState(false);
  const [loading, setLoading] = useState(true);
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

  if (status === 'loading' || loading) {
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
  const kalshiBalance = balances.find((b) => b.platform === 'kalshi')?.balance || 0;
  const polymarketBalance = balances.find((b) => b.platform === 'polymarket')?.balance || 0;

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
          </div>
          <div className="flex items-center space-x-4">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
            title="Kalshi Balance"
            value={`$${kalshiBalance.toFixed(2)}`}
            icon={Wallet}
            color="purple"
          />
          <StatsCard
            title="Polymarket Balance"
            value={`$${polymarketBalance.toFixed(2)}`}
            icon={Wallet}
            color="yellow"
          />
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

