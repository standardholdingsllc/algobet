import { Octokit } from '@octokit/rest';
import { Bet, ArbitrageGroup, BotConfig, DailyStats, AccountBalance, OpportunityLog } from '@/types';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const owner = process.env.GITHUB_OWNER || '';
const repo = process.env.GITHUB_REPO || '';

interface StorageData {
  bets: Bet[];
  arbitrageGroups: ArbitrageGroup[];
  config: BotConfig;
  dailyStats: DailyStats[];
  balances: AccountBalance[];
  opportunityLogs: OpportunityLog[]; // Tracks all opportunities found (simulation mode)
}

const DEFAULT_CONFIG: BotConfig = {
  maxBetPercentage: 10,
  maxDaysToExpiry: 10,
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
  simulationMode: false, // When true, logs opportunities without placing bets
};

const DEFAULT_DATA: StorageData = {
  bets: [],
  arbitrageGroups: [],
  config: DEFAULT_CONFIG,
  dailyStats: [],
  balances: [],
  opportunityLogs: [],
};

async function getFileContent(path: string): Promise<any> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    if ('content' in data) {
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return JSON.parse(content);
    }
    return null;
  } catch (error: any) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function updateFileContent(path: string, content: any, message: string): Promise<void> {
  try {
    // Get current file SHA
    const { data: currentFile } = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    const sha = 'sha' in currentFile ? currentFile.sha : undefined;

    // Update file
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
      sha,
    });
  } catch (error: any) {
    if (error.status === 404) {
      // File doesn't exist, create it
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
      });
    } else {
      throw error;
    }
  }
}

export async function getAllData(): Promise<StorageData> {
  const data = await getFileContent('data/storage.json');
  return data || DEFAULT_DATA;
}

export async function getBets(): Promise<Bet[]> {
  const data = await getAllData();
  return data.bets || [];
}

export async function addBet(bet: Bet): Promise<void> {
  const data = await getAllData();
  data.bets.push(bet);
  await updateFileContent('data/storage.json', data, `Add bet ${bet.id}`);
}

export async function updateBet(betId: string, updates: Partial<Bet>): Promise<void> {
  const data = await getAllData();
  const index = data.bets.findIndex(b => b.id === betId);
  if (index !== -1) {
    data.bets[index] = { ...data.bets[index], ...updates };
    await updateFileContent('data/storage.json', data, `Update bet ${betId}`);
  }
}

export async function getArbitrageGroups(): Promise<ArbitrageGroup[]> {
  const data = await getAllData();
  return data.arbitrageGroups || [];
}

export async function addArbitrageGroup(group: ArbitrageGroup): Promise<void> {
  const data = await getAllData();
  data.arbitrageGroups.push(group);
  await updateFileContent('data/storage.json', data, `Add arbitrage group ${group.id}`);
}

export async function updateArbitrageGroup(groupId: string, updates: Partial<ArbitrageGroup>): Promise<void> {
  const data = await getAllData();
  const index = data.arbitrageGroups.findIndex(g => g.id === groupId);
  if (index !== -1) {
    data.arbitrageGroups[index] = { ...data.arbitrageGroups[index], ...updates };
    await updateFileContent('data/storage.json', data, `Update arbitrage group ${groupId}`);
  }
}

export async function getConfig(): Promise<BotConfig> {
  const data = await getAllData();
  return data.config || DEFAULT_CONFIG;
}

export async function updateConfig(config: Partial<BotConfig>): Promise<void> {
  const data = await getAllData();
  data.config = { ...data.config, ...config };
  await updateFileContent('data/storage.json', data, 'Update bot configuration');
}

export async function getDailyStats(): Promise<DailyStats[]> {
  const data = await getAllData();
  return data.dailyStats || [];
}

export async function addDailyStats(stats: DailyStats): Promise<void> {
  const data = await getAllData();
  // Remove existing stats for the same date
  data.dailyStats = data.dailyStats.filter(s => s.date !== stats.date);
  data.dailyStats.push(stats);
  await updateFileContent('data/storage.json', data, `Add daily stats for ${stats.date}`);
}

export async function getBalances(): Promise<AccountBalance[]> {
  const data = await getAllData();
  return data.balances || [];
}

export async function updateBalances(balances: AccountBalance[]): Promise<void> {
  const data = await getAllData();
  data.balances = balances;
  await updateFileContent('data/storage.json', data, 'Update account balances');
}

export async function getOpportunityLogs(): Promise<OpportunityLog[]> {
  const data = await getAllData();
  return data.opportunityLogs || [];
}

export async function addOpportunityLog(log: OpportunityLog): Promise<void> {
  const data = await getAllData();
  if (!data.opportunityLogs) {
    data.opportunityLogs = [];
  }
  data.opportunityLogs.push(log);
  await updateFileContent('data/storage.json', data, `Add opportunity log ${log.id}`);
}

export async function clearOpportunityLogs(): Promise<void> {
  const data = await getAllData();
  data.opportunityLogs = [];
  await updateFileContent('data/storage.json', data, 'Clear opportunity logs');
}

