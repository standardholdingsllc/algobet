// Test different parameter combinations for SX.bet endpoints
const axios = require('axios');

const BASE_URL = 'https://api.sx.bet';
const API_KEY = process.env.SXBET_API_KEY;
const BASE_TOKEN = '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B';

async function testParameterVariations() {
  console.log('🔧 Testing different parameter combinations...\n');

  if (!API_KEY) {
    console.log('❌ SXBET_API_KEY not set');
    return;
  }

  // Test different parameter combinations for orders endpoints
  const paramVariations = [
    // Corrected endpoints
    { endpoint: '/orders/odds/best', params: { baseToken: BASE_TOKEN } },
    { endpoint: '/orders', params: { baseToken: BASE_TOKEN } },

    // Without baseToken
    { endpoint: '/orders/odds/best', params: {} },
    { endpoint: '/orders', params: {} },

    // With different parameters
    { endpoint: '/orders/odds/best', params: { status: 'active' } },
    { endpoint: '/orders', params: { status: 'active' } },

    // Try different auth headers
    { endpoint: '/orders/odds/best', params: { baseToken: BASE_TOKEN }, auth: 'query' },
  ];

  for (const variation of paramVariations) {
    console.log(`\n🔍 Testing: ${variation.endpoint}`);
    console.log(`Params:`, variation.params);

    try {
      let config = {
        headers: {
          'Content-Type': 'application/json',
        },
        params: variation.params,
      };

      // Try different auth methods
      if (variation.auth === 'query') {
        config.params = { ...config.params, apiKey: API_KEY };
      } else {
        config.headers['X-Api-Key'] = API_KEY;
      }

      const response = await axios.get(`${BASE_URL}${variation.endpoint}`, config);

      console.log(`✅ Status: ${response.status}`);
      console.log(`Data keys:`, Object.keys(response.data || {}));

      if (response.data?.data && Array.isArray(response.data.data)) {
        console.log(`Found ${response.data.data.length} orders`);
        if (response.data.data.length > 0) {
          console.log(`Sample order keys:`, Object.keys(response.data.data[0]));
        }
        // Success! We found working parameters
        console.log(`🎉 SUCCESS! Working parameters found for ${variation.endpoint}`);
        return variation;
      }

    } catch (error) {
      console.log(`❌ Status: ${error.response?.status || 'Error'}`);
      if (error.response?.status !== 404) {
        console.log(`Error details:`, error.response?.data);
      }
    }
  }

  console.log('\n❌ No working parameter combinations found');
  return null;
}

// Also check if there are undocumented endpoints
async function checkForHiddenEndpoints() {
  console.log('\n🔍 Checking for undocumented endpoints...');

  const potentialEndpoints = [
    '/orderbook',
    '/order-book',
    '/markets/orderbook',
    '/markets/order-book',
    '/live-orders',
    '/market-orders',
    '/quotes',
    '/ticker',
  ];

  for (const endpoint of potentialEndpoints) {
    try {
      console.log(`Testing: ${endpoint}`);
      const response = await axios.get(`${BASE_URL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': API_KEY,
        },
        timeout: 5000, // 5 second timeout
      });

      console.log(`✅ ${endpoint} - Status: ${response.status}`);
      return endpoint;

    } catch (error) {
      // Only log non-404 errors (404 means endpoint doesn't exist)
      if (error.response?.status && error.response.status !== 404) {
        console.log(`⚠️ ${endpoint} - Status: ${error.response.status}`);
      }
    }
  }

  console.log('❌ No undocumented endpoints found');
  return null;
}

async function runTests() {
  const workingParams = await testParameterVariations();
  const hiddenEndpoint = await checkForHiddenEndpoints();

  console.log('\n📊 SUMMARY:');
  if (workingParams) {
    console.log(`✅ Found working REST API parameters:`, workingParams);
  }
  if (hiddenEndpoint) {
    console.log(`✅ Found working endpoint: ${hiddenEndpoint}`);
  }
  if (!workingParams && !hiddenEndpoint) {
    console.log('❌ No working REST API methods found');
    console.log('💡 Try WebSocket API: npm run test-sxbet-ws');
  }
}

runTests();
