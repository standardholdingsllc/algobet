// Check if SX.bet environment variables are loaded
console.log('🔧 SX.bet Environment Variable Check\n');
console.log('─'.repeat(50));

const envVars = [
  'SXBET_API_KEY',
  'SXBET_WALLET_ADDRESS',
  'SXBET_PRIVATE_KEY'
];

let allSet = true;

envVars.forEach(varName => {
  const value = process.env[varName];
  const isSet = !!value;
  const status = isSet ? '✅' : '❌';
  const displayValue = isSet ? `(length: ${value.length})` : 'Not set';

  console.log(`${status} ${varName}: ${displayValue}`);

  if (!isSet) {
    allSet = false;
  }
});

console.log('\n' + '─'.repeat(50));

if (allSet) {
  console.log('✅ All SX.bet environment variables are configured!');
  console.log('\n📋 Next steps:');
  console.log('   1. Run: node scripts/debug-sxbet.js');
  console.log('   2. Check if API endpoints are accessible');
} else {
  console.log('❌ Some SX.bet environment variables are missing');
  console.log('\n📋 Required environment variables:');
  console.log('   SXBET_API_KEY - Get from SX.bet Discord');
  console.log('   SXBET_WALLET_ADDRESS - Your SX Network wallet address');
  console.log('   SXBET_PRIVATE_KEY - Private key for signing transactions');
  console.log('\n💡 Make sure these are set in your .env file or environment');
}

console.log('\n🎯 Current working directory:', process.cwd());
console.log('📁 Script location:', __filename);