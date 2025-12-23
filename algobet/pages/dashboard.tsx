import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import StatsCard from '@/components/StatsCard';
import ProfitChart from '@/components/ProfitChart';
import BetsTable from '@/components/BetsTable';
import ConfigPanel from '@/components/ConfigPanel';
import {
  Bet,
  DailyStats,
  AccountBalance,
} from '@/types';
import { TrendingUp, Activity, Wallet, RefreshCw, Radio } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
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
      const [betsRes, statsRes, balancesRes] = await Promise.all([
        fetch('/api/bets'),
        fetch('/api/stats'),
        fetch('/api/balances'),
      ]);

      const betsData = await betsRes.json();
      const statsData = await statsRes.json();
      const balancesData = await balancesRes.json();

      setBets(betsData.bets || []);
      setDailyStats(statsData.stats || []);
      setBalances(balancesData.balances || []);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoading(false);
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

  const avgDailyProfit = dailyStats.length > 0
    ? dailyStats.reduce((sum, stat) => sum + stat.totalProfit, 0) / dailyStats.length
    : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header with Live Betting Link */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-600 mt-1">Monitor your live arbitrage trading</p>
          </div>
          <div className="flex items-center space-x-4">
            <Link
              href="/live-arb"
              className="px-6 py-3 rounded-lg font-semibold transition-colors bg-cyan-600 hover:bg-cyan-700 text-white flex items-center space-x-2"
            >
              <Radio className="w-5 h-5" />
              <span>Live Betting Control</span>
            </Link>
            <button
              onClick={handleRefreshBalances}
              disabled={refreshing}
              className="px-4 py-3 rounded-lg font-semibold transition-colors bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh Balances'}</span>
            </button>
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
