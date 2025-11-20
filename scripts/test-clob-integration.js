const { PolymarketAPI } = require('../lib/markets/polymarket');

async function testCLOBIntegration() {
  console.log('Testing CLOB Integration...');

  const api = new PolymarketAPI();

  try {
    console.log('Testing market fetching...');
    const markets = await api.getOpenMarkets(30);
    console.log(`Found ${markets.length} markets`);

    if (markets.length > 0) {
      console.log('Sample market:', {
        id: markets[0].id,
        title: markets[0].title?.substring(0, 50),
        yesPrice: markets[0].yesPrice,
        noPrice: markets[0].noPrice,
        expiry: markets[0].expiryDate,
      });
    }

    console.log('Testing balance check...');
    const balance = await api.getBalance();
    console.log(`Positions value: $${balance.toFixed(2)}`);

    const totalBalance = await api.getTotalBalance();
    console.log('Total balance:', totalBalance);

    console.log('✅ CLOB integration test completed successfully');
  } catch (error) {
    console.error('❌ CLOB integration test failed:', error.message);
  }
}

testCLOBIntegration();
