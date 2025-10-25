// Check if all required environment variables are set

const required = [
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD_HASH',
  'KALSHI_API_KEY',
  'KALSHI_PRIVATE_KEY',
  'KALSHI_EMAIL',
  'POLYMARKET_API_KEY',
  'POLYMARKET_PRIVATE_KEY',
  'POLYMARKET_WALLET_ADDRESS',
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'GITHUB_REPO',
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASS',
  'ALERT_EMAIL',
];

console.log('🔍 Checking environment variables...\n');

const missing = [];
const present = [];

for (const key of required) {
  if (process.env[key]) {
    present.push(key);
    console.log(`✅ ${key}`);
  } else {
    missing.push(key);
    console.log(`❌ ${key} - MISSING`);
  }
}

console.log(`\n📊 Summary: ${present.length}/${required.length} variables set`);

if (missing.length > 0) {
  console.log('\n⚠️  Missing required environment variables:');
  missing.forEach((key) => console.log(`   - ${key}`));
  console.log('\nPlease add these to your .env file before running the application.');
  process.exit(1);
} else {
  console.log('\n✅ All required environment variables are set!');
  process.exit(0);
}

