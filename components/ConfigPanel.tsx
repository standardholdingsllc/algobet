import { useState, useEffect } from 'react';
import { BotConfig } from '@/types';

interface ConfigPanelProps {
  onUpdate: () => void;
}

export default function ConfigPanel({ onUpdate }: ConfigPanelProps) {
  const [config, setConfig] = useState<BotConfig>({
    maxBetPercentage: 4,
    maxDaysToExpiry: 5,
    minProfitMargin: 0.5,
    balanceThresholds: {
      kalshi: 100,
      polymarket: 100,
      sxbet: 100,
    },
    emailAlerts: {
      enabled: true,
      lowBalanceAlert: true,
    },
    simulationMode: false,
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      if (data.config) {
        setConfig(data.config);
      }
    } catch (error) {
      console.error('Error fetching config:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (response.ok) {
        setMessage('Configuration updated successfully');
        onUpdate();
      } else {
        setMessage('Error updating configuration');
      }
    } catch (error) {
      setMessage('Error updating configuration');
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">Bot Configuration</h2>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Bet Percentage (%)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={config.maxBetPercentage}
              onChange={(e) =>
                setConfig({ ...config, maxBetPercentage: parseFloat(e.target.value) })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Days to Expiry
            </label>
            <input
              type="number"
              min="1"
              max="30"
              value={config.maxDaysToExpiry}
              onChange={(e) =>
                setConfig({ ...config, maxDaysToExpiry: parseInt(e.target.value) })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Min Profit Margin (%)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={config.minProfitMargin}
              onChange={(e) =>
                setConfig({ ...config, minProfitMargin: parseFloat(e.target.value) })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Kalshi Balance Threshold ($)
            </label>
            <input
              type="number"
              min="0"
              value={config.balanceThresholds.kalshi}
              onChange={(e) =>
                setConfig({
                  ...config,
                  balanceThresholds: {
                    ...config.balanceThresholds,
                    kalshi: parseFloat(e.target.value),
                  },
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Polymarket Balance Threshold ($)
            </label>
            <input
              type="number"
              min="0"
              value={config.balanceThresholds.polymarket}
              onChange={(e) =>
                setConfig({
                  ...config,
                  balanceThresholds: {
                    ...config.balanceThresholds,
                    polymarket: parseFloat(e.target.value),
                  },
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              SXBet Balance Threshold ($)
            </label>
            <input
              type="number"
              min="0"
              value={config.balanceThresholds.sxbet}
              onChange={(e) =>
                setConfig({
                  ...config,
                  balanceThresholds: {
                    ...config.balanceThresholds,
                    sxbet: parseFloat(e.target.value),
                  },
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="emailAlerts"
              checked={config.emailAlerts.enabled}
              onChange={(e) => setConfig({ 
                ...config, 
                emailAlerts: {
                  ...config.emailAlerts,
                  enabled: e.target.checked
                }
              })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="emailAlerts" className="ml-2 block text-sm text-gray-700">
              Enable Email Alerts
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="lowBalanceAlert"
              checked={config.emailAlerts.lowBalanceAlert}
              onChange={(e) => setConfig({ 
                ...config, 
                emailAlerts: {
                  ...config.emailAlerts,
                  lowBalanceAlert: e.target.checked
                }
              })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="lowBalanceAlert" className="ml-2 block text-sm text-gray-700">
              Low Balance Alerts
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="simulationMode"
              checked={config.simulationMode}
              onChange={(e) => setConfig({ 
                ...config, 
                simulationMode: e.target.checked
              })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="simulationMode" className="ml-2 block text-sm text-gray-700">
              Simulation Mode (Log Only)
            </label>
          </div>
        </div>

        {message && (
          <div
            className={`px-4 py-3 rounded ${
              message.includes('Error')
                ? 'bg-red-50 text-red-700 border border-red-200'
                : 'bg-green-50 text-green-700 border border-green-200'
            }`}
          >
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Updating...' : 'Update Configuration'}
        </button>
      </form>
    </div>
  );
}

