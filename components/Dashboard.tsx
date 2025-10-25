'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, DollarSign, BarChart3, Settings as SettingsIcon, LogOut } from 'lucide-react';
import StatsCard from './StatsCard';
import OpportunitiesTable from './OpportunitiesTable';
import BetsTable from './BetsTable';
import ProfitChart from './ProfitChart';
import Settings from './Settings';
import { DataStore } from '@/types';

export default function Dashboard() {
  const [dataStore, setDataStore] = useState<DataStore | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'opportunities' | 'bets' | 'settings'>('overview');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const response = await fetch('/api/data');
      const data = await response.json();
      setDataStore(data);
      setIsLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  };

  if (isLoading || !dataStore) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading dashboard...</div>
      </div>
    );
  }

  const todayProfit = dataStore.profits[dataStore.profits.length - 1]?.profit || 0;
  const totalProfit = dataStore.profits.reduce((sum, p) => sum + p.profit, 0);
  const activeBets = dataStore.bets.filter(b => b.status === 'filled').length;
  const kalshiBalance = dataStore.balances.find(b => b.platform === 'kalshi')?.balance || 0;
  const polymarketBalance = dataStore.balances.find(b => b.platform === 'polymarket')?.balance || 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              AlgoBet Dashboard
            </h1>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {[
              { id: 'overview', label: 'Overview', icon: BarChart3 },
              { id: 'opportunities', label: 'Opportunities', icon: TrendingUp },
              { id: 'bets', label: 'Bets', icon: DollarSign },
              { id: 'settings', label: 'Settings', icon: SettingsIcon },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatsCard
                title="Today's Profit"
                value={`$${todayProfit.toFixed(2)}`}
                change={todayProfit > 0 ? `+${todayProfit.toFixed(2)}` : '0.00'}
                icon={DollarSign}
                positive={todayProfit > 0}
              />
              <StatsCard
                title="Total Profit"
                value={`$${totalProfit.toFixed(2)}`}
                change={`${dataStore.profits.length} days`}
                icon={TrendingUp}
                positive={totalProfit > 0}
              />
              <StatsCard
                title="Active Bets"
                value={activeBets.toString()}
                change={`${dataStore.opportunities.length} opportunities`}
                icon={BarChart3}
              />
              <StatsCard
                title="Total Balance"
                value={`$${(kalshiBalance + polymarketBalance).toFixed(2)}`}
                change={`K: $${kalshiBalance.toFixed(0)} | P: $${polymarketBalance.toFixed(0)}`}
                icon={DollarSign}
              />
            </div>

            {/* Profit Chart */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-4">Profit Over Time</h2>
              <ProfitChart data={dataStore.profits} />
            </div>

            {/* Recent Opportunities */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-4">Recent Opportunities</h2>
              <OpportunitiesTable
                opportunities={dataStore.opportunities.slice(-10).reverse()}
                compact
              />
            </div>
          </div>
        )}

        {activeTab === 'opportunities' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <OpportunitiesTable opportunities={dataStore.opportunities.reverse()} />
          </div>
        )}

        {activeTab === 'bets' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <BetsTable bets={dataStore.bets.reverse()} />
          </div>
        )}

        {activeTab === 'settings' && (
          <Settings config={dataStore.config} onUpdate={loadData} />
        )}
      </main>
    </div>
  );
}

