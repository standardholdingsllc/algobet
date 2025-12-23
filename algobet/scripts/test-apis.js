// Test API connections to Kalshi and Polymarket

const axios = require('axios');

async function testKalshi() {
  console.log('🔍 Testing Kalshi API...');
  try {
    const response = await axios.get('https://api.kalshi.com/trade-api/v2/markets', {
      params: { limit: 1 },
    });
    console.log('✅ Kalshi API is accessible');
    console.log(`   Found ${response.data.markets?.length || 0} markets`);
    return true;
  } catch (error) {
    console.log('❌ Kalshi API error:', error.message);
    return false;
  }
}

async function testPolymarket() {
  console.log('\n🔍 Testing Polymarket API...');
  try {
    const response = await axios.get('https://gamma-api.polymarket.com/markets', {
      params: { limit: 1 },
    });
    console.log('✅ Polymarket API is accessible');
    console.log(`   Found ${response.data?.length || 0} markets`);
    return true;
  } catch (error) {
    console.log('❌ Polymarket API error:', error.message);
    return false;
  }
}

async function testSXBet() {
  console.log('\n🔍 Testing SX.bet API...');
  const apiKey = process.env.SBET_API_KEY;

  if (!apiKey) {
    console.log('❌ SBET_API_KEY not set');
    return false;
  }

  try {
    const response = await axios.get('https://api.sx.bet/markets/active', {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      params: {
        baseToken: '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B', // USDC on SX mainnet
      },
    });
    console.log('✅ SX.bet API is accessible');
    console.log(`   Found ${response.data.data?.length || 0} markets`);
    return true;
  } catch (error) {
    console.log('❌ SX.bet API error:', error.response?.status, error.message);
    return false;
  }
}

async function testGitHub() {
  console.log('\n🔍 Testing GitHub API...');
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.log('❌ GITHUB_TOKEN not set');
    return false;
  }

  try {
    const response = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
      },
    });
    console.log('✅ GitHub API is accessible');
    console.log(`   Authenticated as: ${response.data.login}`);
    return true;
  } catch (error) {
    console.log('❌ GitHub API error:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Testing API Connections\n');
  console.log('─'.repeat(50));

  const kalshiOk = await testKalshi();
  const polymarketOk = await testPolymarket();
  const sxbetOk = await testSXBet();
  const githubOk = await testGitHub();

  console.log('\n' + '─'.repeat(50));
  console.log('\n📊 Summary:');
  console.log(`   Kalshi: ${kalshiOk ? '✅' : '❌'}`);
  console.log(`   Polymarket: ${polymarketOk ? '✅' : '❌'}`);
  console.log(`   SX.bet: ${sxbetOk ? '✅' : '❌'}`);
  console.log(`   GitHub: ${githubOk ? '✅' : '❌'}`);

  if (kalshiOk && polymarketOk && sxbetOk && githubOk) {
    console.log('\n✅ All APIs are working correctly!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some APIs are not accessible. Please check your configuration.');
    process.exit(1);
  }
}

runTests();

