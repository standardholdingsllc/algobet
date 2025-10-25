'use client';

import { useState } from 'react';
import { SystemConfig } from '@/types';
import { Save } from 'lucide-react';

interface SettingsProps {
  config: SystemConfig;
  onUpdate: () => void;
}

export default function Settings({ config, onUpdate }: SettingsProps) {
  const [formData, setFormData] = useState(config);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage('');

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setMessage('Settings saved successfully!');
        onUpdate();
      } else {
        setMessage('Error saving settings');
      }
    } catch (error) {
      setMessage('Error saving settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">System Configuration</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Minimum Balance - Kalshi ($)
          </label>
          <input
            type="number"
            value={formData.minBalanceKalshi}
            onChange={(e) => setFormData({ ...formData, minBalanceKalshi: parseFloat(e.target.value) })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700"
            step="0.01"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Alert will be sent when Kalshi balance falls below this amount
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Minimum Balance - Polymarket ($)
          </label>
          <input
            type="number"
            value={formData.minBalancePolymarket}
            onChange={(e) => setFormData({ ...formData, minBalancePolymarket: parseFloat(e.target.value) })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700"
            step="0.01"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Alert will be sent when Polymarket balance falls below this amount
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Max Bet Percentage (%)
          </label>
          <input
            type="number"
            value={formData.maxBetPercentage}
            onChange={(e) => setFormData({ ...formData, maxBetPercentage: parseFloat(e.target.value) })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700"
            step="0.1"
            min="0.1"
            max="10"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Maximum percentage of account balance to risk per bet (recommended: 4%)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Max Days to Expiry
          </label>
          <input
            type="number"
            value={formData.maxDaysToExpiry}
            onChange={(e) => setFormData({ ...formData, maxDaysToExpiry: parseInt(e.target.value) })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700"
            min="1"
            max="30"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Only bet on markets expiring within this many days
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Alert Email
          </label>
          <input
            type="email"
            value={formData.alertEmail}
            onChange={(e) => setFormData({ ...formData, alertEmail: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Email address to receive alerts and daily summaries
          </p>
        </div>

        {message && (
          <div className={`p-4 rounded-lg ${
            message.includes('success') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={isSaving}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}

