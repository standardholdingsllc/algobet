// Test accessing specific market details and order books
const axios = require('axios');

const BASE_URL = 'https://api.sx.bet';
const API_KEY = process.env.SXBET_API_KEY;
const BASE_TOKEN = '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B';

async function testSpecificMarket() {
  console.log('🎯 Testing specific market access...\n');

  if (!API_KEY) {
    console.log('❌ SXBET_API_KEY not set');
    return;
  }

  try {
    // First get some markets
    const marketsResponse = await axios.get(`${BASE_URL}/markets/active`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': API_KEY,
      },
      params: { baseToken: BASE_TOKEN },
    });

    const markets = marketsResponse.data.data || [];
    console.log(`Found ${markets.length} markets`);

    if (markets.length > 0) {
      // Try to get details for the first market
      const firstMarket = markets[0];
      console.log(`Testing market: ${firstMarket.marketHash}`);

      // Try different endpoint variations
      const endpointsToTest = [
        `/markets/${firstMarket.marketHash}`,
        `/orders?marketHash=${firstMarket.marketHash}`,
        `/orders/best-odds?marketHash=${firstMarket.marketHash}`,
        `/orders/active?marketHash=${firstMarket.marketHash}`,
        `/orderbook/${firstMarket.marketHash}`,
      ];

      for (const endpoint of endpointsToTest) {
        try {
          console.log(`\nTesting: ${endpoint}`);
          const response = await axios.get(`${BASE_URL}${endpoint}`, {
            headers: {
              'Content-Type': 'application/json',
              'X-Api-Key': API_KEY,
            },
            params: { baseToken: BASE_TOKEN },
          });
          console.log(`✅ ${endpoint} - Status: ${response.status}`);
          console.log(`Data keys:`, Object.keys(response.data || {}));
        } catch (error) {
          console.log(`❌ ${endpoint} - Status: ${error.response?.status || 'Error'}`);
        }
      }
    }

  } catch (error) {
    console.log('❌ Error getting markets:', error.message);
  }
}

testSpecificMarket();
