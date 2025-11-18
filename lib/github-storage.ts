import { Octokit } from '@octokit/rest';
import { DataStore } from '@/types';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const owner = process.env.GITHUB_OWNER || '';
const repo = process.env.GITHUB_REPO || '';
const branch = process.env.GITHUB_DATA_BRANCH || 'main';

export class GitHubStorage {
  static async readData(path: string): Promise<any> {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });

      if ('content' in data && data.content) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return JSON.parse(content);
      }
      return null;
    } catch (error: any) {
      if (error.status === 404) {
        return null; // File doesn't exist yet
      }
      throw error;
    }
  }

  static async writeData(path: string, data: any, message: string): Promise<void> {
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');

    try {
      // Try to get the file first to get its SHA
      const { data: existingFile } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });

      // Update existing file
      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content,
        branch,
        sha: 'sha' in existingFile ? existingFile.sha : undefined,
      });
    } catch (error: any) {
      if (error.status === 404) {
        // Create new file
        await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message,
          content,
          branch,
        });
      } else {
        throw error;
      }
    }
  }

  static async getDataStore(): Promise<DataStore> {
    const data = await this.readData('data/store.json');
    
    if (!data) {
      // Initialize empty data store
      const initialStore: DataStore = {
        opportunities: [],
        bets: [],
        balances: [],
        profits: [],
        config: {
          maxBetPercentage: parseFloat(process.env.MAX_BET_PERCENTAGE || '4'),
          maxDaysToExpiry: parseInt(process.env.MAX_DAYS_TO_EXPIRY || '5'),
          minProfitMargin: parseFloat(process.env.MIN_PROFIT_MARGIN || '0.5'),
          balanceThresholds: {
            kalshi: parseFloat(process.env.MIN_BALANCE_KALSHI || '100'),
            polymarket: parseFloat(process.env.MIN_BALANCE_POLYMARKET || '100'),
            sxbet: parseFloat(process.env.MIN_BALANCE_SXBET || '100'),
          },
          emailAlerts: {
            enabled: process.env.EMAIL_ALERTS_ENABLED === 'true',
            lowBalanceAlert: process.env.LOW_BALANCE_ALERT === 'true',
          },
          simulationMode: process.env.SIMULATION_MODE === 'true',
        },
      };
      await this.writeData('data/store.json', initialStore, 'Initialize data store');
      return initialStore;
    }

    return data;
  }

  static async updateDataStore(store: DataStore): Promise<void> {
    await this.writeData('data/store.json', store, 'Update data store');
  }
}

