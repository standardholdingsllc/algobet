// Comprehensive SX.bet API test
const axios = require('axios');

const BASE_URL = 'https://api.sx.bet';
const API_KEY = process.env.SXBET_API_KEY;
const BASE_TOKEN = '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B';

async function testEndpoint(name, url, params = {}, method = 'GET') {
  console.log(`\n🔍 Testing ${name}...`);
  console.log(`URL: ${url}`);
  console.log(`Method: ${method}`);
  console.log(`API Key present: ${!!API_KEY}`);

  const config = {
    method,
    url,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY,
    },
    params,
  };

  console.log(`Headers:`, config.headers);
  console.log(`Params:`, params);

  try {
    const response = await axios(config);

    console.log(`✅ ${name} - Status: ${response.status}`);
    console.log(`Response headers:`, response.headers);
    console.log(`Data keys:`, Object.keys(response.data || {}));

    if (response.data?.data) {
      const data = response.data.data;
      if (Array.isArray(data)) {
        console.log(`Data is array with ${data.length} items`);
        if (data.length > 0) {
          console.log(`First item keys:`, Object.keys(data[0]));
        }
      } else {
        console.log(`Data keys:`, Object.keys(data));
      }
    }

    return { success: true, status: response.status, data: response.data };
  } catch (error) {
    console.log(`❌ ${name} - Status: ${error.response?.status || 'Network Error'}`);
    console.log(`Error message:`, error.message);

    if (error.response) {
      console.log(`Response headers:`, error.response.headers);
      console.log(`Response data:`, error.response.data);
    }

    return { success: false, status: error.response?.status, error: error.response?.data };
  }
}

async function runComprehensiveTest() {
  console.log('🚀 Comprehensive SX.bet API Test\n');
  console.log('─'.repeat(60));
  console.log(`API Key configured: ${!!API_KEY}`);
  console.log(`API Key length: ${API_KEY?.length || 0}`);
  console.log('─'.repeat(60));

  if (!API_KEY) {
    console.log('❌ SXBET_API_KEY environment variable not set!');
    console.log('Please set your SX.bet API key.');
    process.exit(1);
  }

  // Test 1: Basic connectivity (no auth required endpoints if any)
  console.log('\n📡 Testing basic connectivity...');

  // Test 2: Markets active (should work)
  const marketsResult = await testEndpoint(
    'Markets Active',
    `${BASE_URL}/markets/active`,
    { baseToken: BASE_TOKEN }
  );

  // Test 3: Metadata (should work)
  const metadataResult = await testEndpoint(
    'Metadata',
    `${BASE_URL}/metadata`
  );

  // Test 4: Fixtures (corrected endpoint)
  const fixturesResult = await testEndpoint(
    'Fixtures',
    `${BASE_URL}/fixture/active`
  );

  // Test 5: Best odds (corrected endpoint)
  const bestOddsResult = await testEndpoint(
    'Best Odds',
    `${BASE_URL}/orders/odds/best`,
    { baseToken: BASE_TOKEN }
  );

  // Test 6: Active orders (corrected endpoint)
  const activeOrdersResult = await testEndpoint(
    'Active Orders',
    `${BASE_URL}/orders`,
    { baseToken: BASE_TOKEN }
  );

  // Test 7: Try without baseToken parameter
  const bestOddsNoTokenResult = await testEndpoint(
    'Best Odds (no baseToken)',
    `${BASE_URL}/orders/best-odds`,
    {}
  );

  // Test 8: Try different auth header
  console.log('\n🔐 Testing alternative auth methods...');
  const altAuthResult = await testEndpoint(
    'Best Odds (alt auth)',
    `${BASE_URL}/orders/best-odds`,
    { baseToken: BASE_TOKEN },
    'GET'
  );

  console.log('\n' + '─'.repeat(60));
  console.log('📊 SUMMARY:');

  const results = [
    { name: 'Markets Active', result: marketsResult },
    { name: 'Metadata', result: metadataResult },
    { name: 'Fixtures', result: fixturesResult },
    { name: 'Best Odds', result: bestOddsResult },
    { name: 'Active Orders', result: activeOrdersResult },
  ];

  results.forEach(({ name, result }) => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${name}: ${result.status || 'Failed'}`);
  });

  const workingEndpoints = results.filter(r => r.result.success).length;
  const failedEndpoints = results.filter(r => !r.result.success).length;

  console.log(`\n📈 Results: ${workingEndpoints} working, ${failedEndpoints} failed`);

  if (failedEndpoints > 0) {
    console.log('\n🔍 POSSIBLE ISSUES:');
    console.log('1. API key may be expired or invalid');
    console.log('2. API key may not have correct permissions');
    console.log('3. Using testnet key for mainnet (or vice versa)');
    console.log('4. SX.bet API may have changed');
    console.log('5. Regional/IP restrictions');
    console.log('\n💡 Contact SX.bet Discord: https://discord.gg/sxbet');
  }

  console.log('\n✅ Test complete.');
}

runComprehensiveTest().catch(console.error);
