
import { KalshiService } from '../services/kalshi';
import { PolymarketService } from '../services/polymarket';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function checkBalances() {
  console.log('--- Starting Balance Check ---');
  
  const kalshiService = new KalshiService();
  const polymarketService = new PolymarketService();

  try {
    console.log('\nChecking Kalshi...');
    const kalshiBalances = await kalshiService.getTotalBalance();
    console.log('Kalshi Result:', JSON.stringify(kalshiBalances, null, 2));
  } catch (error) {
    console.error('Kalshi Error:', error);
  }

  try {
    console.log('\nChecking Polymarket...');
    const polymarketBalances = await polymarketService.getTotalBalance();
    console.log('Polymarket Result:', JSON.stringify(polymarketBalances, null, 2));
  } catch (error) {
    console.error('Polymarket Error:', error);
  }
  
  console.log('\n--- Balance Check Complete ---');
}

checkBalances();

