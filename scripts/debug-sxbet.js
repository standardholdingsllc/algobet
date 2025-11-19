// Debug SX.bet API endpoints
const axios = require('axios');

const BASE_URL = 'https://api.sx.bet';
const API_KEY = process.env.SBET_API_KEY;
const BASE_TOKEN = '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B';

async function testEndpoint(name, url, params = {}, headers = {}) {
  console.log(`\n🔍 Testing ${name}...`);
  console.log(`URL: ${url}`);
  console.log(`Params:`, params);

  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': API_KEY,
        ...headers
      },
      params
    });

    console.log(`✅ ${name} - Status: ${response.status}`);
    console.log(`   Data keys:`, Object.keys(response.data || {}));
    if (response.data?.data) {
      console.log(`   Data length:`, Array.isArray(response.data.data) ? response.data.data.length : 'N/A');
    }
    return true;
  } catch (error) {
    console.log(`❌ ${name} - Status: ${error.response?.status || 'Unknown'}`);
    console.log(`   Error:`, error.response?.data?.message || error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Debugging SX.bet API endpoints\n');
  console.log('─'.repeat(50));
  console.log(`API Key configured: ${!!API_KEY}`);
  console.log(`API Key length: ${API_KEY?.length || 0}`);
  console.log('─'.repeat(50));

  // Test basic connectivity
  await testEndpoint('Markets Active', `${BASE_URL}/markets/active`, {
    baseToken: BASE_TOKEN
  });

  // Test fixtures without params
  await testEndpoint('Fixtures (no params)', `${BASE_URL}/fixtures`);

  // Test fixtures with status
  await testEndpoint('Fixtures (status=1)', `${BASE_URL}/fixtures`, {
    status: 1
  });

  // Test best odds
  await testEndpoint('Best Odds', `${BASE_URL}/orders/best-odds`, {
    baseToken: BASE_TOKEN
  });

  // Test active orders
  await testEndpoint('Active Orders', `${BASE_URL}/orders/active`, {
    baseToken: BASE_TOKEN
  });

  // Test metadata
  await testEndpoint('Metadata', `${BASE_URL}/metadata`);

  console.log('\n' + '─'.repeat(50));
  console.log('Debug complete. Check responses above.');
}

runTests();
