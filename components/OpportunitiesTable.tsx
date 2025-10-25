import { ArbitrageOpportunity } from '@/types';
import { Download } from 'lucide-react';

interface OpportunitiesTableProps {
  opportunities: ArbitrageOpportunity[];
  compact?: boolean;
}

export default function OpportunitiesTable({ opportunities, compact }: OpportunitiesTableProps) {
  const handleExport = async (format: 'csv' | 'json') => {
    const response = await fetch(`/api/export/opportunities?format=${format}`);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opportunities_${new Date().toISOString().split('T')[0]}.${format}`;
    a.click();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'placed': return 'bg-green-100 text-green-800';
      case 'filled': return 'bg-blue-100 text-blue-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div>
      {!compact && (
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Arbitrage Opportunities</h2>
          <div className="flex gap-2">
            <button
              onClick={() => handleExport('csv')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button
              onClick={() => handleExport('json')}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition"
            >
              <Download className="w-4 h-4" />
              Export JSON
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Time
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Markets
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Profit %
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Net Profit
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Expiry
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {opportunities.slice(0, compact ? 5 : undefined).map((opp) => (
              <tr key={opp.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {new Date(opp.timestamp).toLocaleString()}
                </td>
                <td className="px-6 py-4 text-sm">
                  <div className="space-y-1">
                    <div className="text-blue-600">{opp.market1.platform}: {opp.side1.toUpperCase()}</div>
                    <div className="text-purple-600">{opp.market2.platform}: {opp.side2.toUpperCase()}</div>
                    <div className="text-gray-500 text-xs truncate max-w-xs">{opp.market1.title}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600">
                  {opp.profitMargin.toFixed(2)}%
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  ${opp.expectedProfit.toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                    detected
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {new Date(opp.market1.expiryDate).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {opportunities.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No opportunities detected yet
        </div>
      )}
    </div>
  );
}

