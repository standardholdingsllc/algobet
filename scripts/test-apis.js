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
  const githubOk = await testGitHub();
  
  console.log('\n' + '─'.repeat(50));
  console.log('\n📊 Summary:');
  console.log(`   Kalshi: ${kalshiOk ? '✅' : '❌'}`);
  console.log(`   Polymarket: ${polymarketOk ? '✅' : '❌'}`);
  console.log(`   GitHub: ${githubOk ? '✅' : '❌'}`);
  
  if (kalshiOk && polymarketOk && githubOk) {
    console.log('\n✅ All APIs are working correctly!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some APIs are not accessible. Please check your configuration.');
    process.exit(1);
  }
}

runTests();

