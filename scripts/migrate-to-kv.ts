/**
 * Migration script to transfer data from GitHub storage to Vercel KV
 * Run this once after deploying the KV storage changes
 */

import { getAllData } from '../lib/storage';
import { KVStorage } from '../lib/kv-storage';

async function migrate() {
  console.log('🔄 Starting migration from GitHub to Vercel KV...');
  
  try {
    // Read all data from GitHub storage
    console.log('📖 Reading data from GitHub...');
    const githubData = await getAllData();
    
    console.log('📊 Data summary:');
    console.log(`  - Bets: ${githubData.bets.length}`);
    console.log(`  - Arbitrage Groups: ${githubData.arbitrageGroups.length}`);
    console.log(`  - Daily Stats: ${githubData.dailyStats.length}`);
    console.log(`  - Balances: ${githubData.balances.length}`);
    console.log(`  - Opportunity Logs: ${githubData.opportunityLogs.length}`);
    
    // Write to KV storage
    console.log('💾 Writing data to Vercel KV...');
    await KVStorage.migrateFromGitHub(githubData);
    
    // Verify migration
    console.log('✅ Verifying migration...');
    const kvData = await KVStorage.getAllData();
    
    console.log('📊 Verification:');
    console.log(`  - Bets: ${kvData.bets.length} ✓`);
    console.log(`  - Arbitrage Groups: ${kvData.arbitrageGroups.length} ✓`);
    console.log(`  - Daily Stats: ${kvData.dailyStats.length} ✓`);
    console.log(`  - Balances: ${kvData.balances.length} ✓`);
    console.log(`  - Opportunity Logs: ${kvData.opportunityLogs.length} ✓`);
    
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Verify the data in your dashboard');
    console.log('2. Monitor the bot to ensure it works correctly');
    console.log('3. Once confirmed, you can keep data/storage.json as a backup');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();

