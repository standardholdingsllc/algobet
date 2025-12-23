import Papa from 'papaparse';
import { Bet, ArbitrageGroup } from '@/types';
import { getBets, getArbitrageGroups } from './storage';
import { startOfDay, endOfDay, subDays, subWeeks, subMonths, subYears } from 'date-fns';

export type ExportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

interface ExportOptions {
  period: ExportPeriod;
  format: 'csv' | 'json';
  startDate?: Date;
  endDate?: Date;
}

export async function exportData(options: ExportOptions): Promise<{ data: string; filename: string }> {
  const { startDate, endDate } = getDateRange(options.period, options.startDate, options.endDate);

  const allBets = await getBets();
  const allGroups = await getArbitrageGroups();

  // Filter by date range
  const filteredBets = allBets.filter((bet) => {
    const betDate = new Date(bet.placedAt);
    return betDate >= startDate && betDate <= endDate;
  });

  const filteredGroups = allGroups.filter((group) => {
    const groupDate = new Date(group.createdAt);
    return groupDate >= startDate && groupDate <= endDate;
  });

  // Calculate totals
  const totalInvested = filteredGroups.reduce((sum, group) => sum + (group.bet1.amount + group.bet2.amount), 0);
  const totalProfit = filteredGroups
    .filter((g) => g.status === 'resolved')
    .reduce((sum, group) => sum + (group.actualProfit || 0), 0);
  const roi = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

  const exportData = {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    bets: filteredBets,
    arbitrageGroups: filteredGroups,
    totalProfit,
    totalInvested,
    roi,
  };

  const filename = `algobet-export-${options.period}-${startDate.toISOString().split('T')[0]}.${options.format}`;

  if (options.format === 'json') {
    return {
      data: JSON.stringify(exportData, null, 2),
      filename,
    };
  } else {
    // CSV format - flatten the data
    const csvData = filteredBets.map((bet) => ({
      Date: new Date(bet.placedAt).toISOString(),
      Platform: bet.platform,
      Ticker: bet.ticker,
      Title: bet.marketTitle,
      Side: bet.side,
      Price: bet.price,
      Amount: bet.amount,
      Status: bet.status,
      Profit: bet.profit || 0,
      'Arbitrage Group ID': bet.arbitrageGroupId || '',
    }));

    const csv = Papa.unparse(csvData);
    return { data: csv, filename };
  }
}

function getDateRange(
  period: ExportPeriod,
  customStart?: Date,
  customEnd?: Date
): { startDate: Date; endDate: Date } {
  const now = new Date();
  let startDate: Date;
  let endDate: Date = endOfDay(now);

  switch (period) {
    case 'daily':
      startDate = startOfDay(now);
      break;
    case 'weekly':
      startDate = startOfDay(subWeeks(now, 1));
      break;
    case 'monthly':
      startDate = startOfDay(subMonths(now, 1));
      break;
    case 'yearly':
      startDate = startOfDay(subYears(now, 1));
      break;
    case 'custom':
      startDate = customStart ? startOfDay(customStart) : startOfDay(subMonths(now, 1));
      endDate = customEnd ? endOfDay(customEnd) : endOfDay(now);
      break;
    default:
      startDate = startOfDay(subMonths(now, 1));
  }

  return { startDate, endDate };
}

export async function generateDailyReport(): Promise<any> {
  const allBets = await getBets();
  const allGroups = await getArbitrageGroups();

  const today = startOfDay(new Date());
  const todayBets = allBets.filter((bet) => {
    const betDate = startOfDay(new Date(bet.placedAt));
    return betDate.getTime() === today.getTime();
  });

  const todayGroups = allGroups.filter((group) => {
    const groupDate = startOfDay(new Date(group.createdAt));
    return groupDate.getTime() === today.getTime();
  });

  const activeBets = allBets.filter((bet) => bet.status === 'filled' || bet.status === 'pending');
  const resolvedToday = todayBets.filter((bet) => bet.status === 'resolved');

  const todayProfit = todayGroups
    .filter((g) => g.status === 'resolved')
    .reduce((sum, group) => sum + (group.actualProfit || 0), 0);

  const todayInvested = todayGroups.reduce((sum, group) => sum + (group.bet1.amount + group.bet2.amount), 0);
  const todayROI = todayInvested > 0 ? (todayProfit / todayInvested) * 100 : 0;

  return {
    date: today.toISOString().split('T')[0],
    totalBets: todayBets.length,
    activeBets: activeBets.length,
    resolvedBets: resolvedToday.length,
    profit: todayProfit,
    roi: todayROI,
    invested: todayInvested,
  };
}

