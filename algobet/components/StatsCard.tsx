import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string; // Secondary value (like available cash)
  change?: string;
  icon?: LucideIcon;
  positive?: boolean;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple';
}

export default function StatsCard({
  title,
  value,
  subtitle,
  change,
  icon: Icon,
  positive,
  trend,
  color = 'blue',
}: StatsCardProps) {
  // Debug logging for balance cards - UPDATED
  if (title.includes('Balance')) {
    console.log(`StatsCard ${title} [v2]:`, { value, subtitle, change, hasSubtitle: !!subtitle, hasChange: !!change });
  }
  
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
  };

  const trendIcons = {
    up: '↑',
    down: '↓',
    neutral: '→',
  };

  return (
    <div className={`bg-white p-6 rounded-lg shadow border-l-4 ${colorClasses[color]}`}>
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
          {subtitle && (
            <p className="text-sm text-gray-500 mt-1">
              {subtitle}
            </p>
          )}
          {change && (
            <p className={`text-sm mt-1 ${positive !== undefined ? (positive ? 'text-green-600' : 'text-red-600') : 'text-gray-500'}`}>
              {trend && <span className="mr-1">{trendIcons[trend]}</span>}
              {change}
            </p>
          )}
        </div>
        {Icon && <Icon className="w-8 h-8 text-gray-400" />}
      </div>
    </div>
  );
}
