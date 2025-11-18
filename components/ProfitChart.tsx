import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ProfitData } from '@/types';

interface ProfitChartProps {
  data: ProfitData[];
}

export default function ProfitChart({ data }: ProfitChartProps) {
  // Calculate cumulative profit
  let cumulativeProfit = 0;
  const chartData = data.map((stat) => {
    cumulativeProfit += stat.profit;
    return {
      date: new Date(stat.date).toLocaleDateString(),
      profit: stat.profit,
      cumulativeProfit: cumulativeProfit,
    };
  });

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">Daily Profit Over Time</h2>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip
            formatter={(value: number) => `$${value.toFixed(2)}`}
            labelStyle={{ color: '#000' }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="cumulativeProfit"
            stroke="#3b82f6"
            strokeWidth={2}
            name="Cumulative Profit"
          />
          <Line
            type="monotone"
            dataKey="profit"
            stroke="#10b981"
            strokeWidth={2}
            name="Daily Profit"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
