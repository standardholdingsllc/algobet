#!/usr/bin/env node

/**
 * Test if Vercel environment has correct Kalshi credentials
 */

const crypto = require('crypto');

console.log('🔍 Checking Vercel Kalshi Configuration\n');

// Check if environment variables exist
const apiKey = process.env.KALSHI_API_KEY;
const privateKey = process.env.KALSHI_PRIVATE_KEY;

if (!apiKey) {
  console.log('❌ KALSHI_API_KEY is not set');
  console.log('   Run: vercel env add KALSHI_API_KEY production');
  process.exit(1);
}

if (!privateKey) {
  console.log('❌ KALSHI_PRIVATE_KEY is not set');
  console.log('   Run: vercel env add KALSHI_PRIVATE_KEY production');
  process.exit(1);
}

console.log('✅ Both environment variables are set\n');
console.log('API Key:', apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4));
console.log('Private Key Length:', privateKey.length, 'characters\n');

// Check private key format
console.log('📋 Private Key Analysis:');
console.log('  Has \\n:', privateKey.includes('\\n'));
console.log('  Has actual newlines:', privateKey.includes('\n'));
console.log('  Has BEGIN header:', privateKey.includes('-----BEGIN'));
console.log('  Has END footer:', privateKey.includes('-----END'));

// Try to use the key
console.log('\n🧪 Testing Private Key Signing...');

let formattedKey = privateKey;

// Format the key (same logic as app)
if (formattedKey.includes('\\n')) {
  formattedKey = formattedKey.replace(/\\n/g, '\n');
  console.log('  ✓ Converted \\n to newlines');
}

if (!formattedKey.includes('-----BEGIN')) {
  formattedKey = `-----BEGIN RSA PRIVATE KEY-----\n${formattedKey}\n-----END RSA PRIVATE KEY-----`;
  console.log('  ✓ Added headers');
}

// Try RSA to PKCS#8 conversion
if (formattedKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
  try {
    const keyObject = crypto.createPrivateKey({
      key: formattedKey,
      format: 'pem',
      type: 'pkcs1'
    });
    formattedKey = keyObject.export({
      type: 'pkcs8',
      format: 'pem'
    });
    console.log('  ✓ Converted RSA to PKCS#8');
  } catch (error) {
    console.log('  ⚠ RSA conversion failed:', error.message);
  }
}

// Test signing
try {
  const timestamp = Date.now().toString();
  const message = `${timestamp}GET/trade-api/v2/portfolio/balance`;
  
  const signer = crypto.createSign('SHA256');
  signer.update(message);
  signer.end();
  
  const signature = signer.sign(formattedKey, 'base64');
  
  console.log('\n✅ SUCCESS! Private key can sign messages');
  console.log('   Signature:', signature.substring(0, 40) + '...');
  console.log('\n💡 The private key format is correct!');
  console.log('   If still getting 401, the API key and private key may not be a matching pair.');
  console.log('   Make sure you downloaded BOTH from the same API key in Kalshi dashboard.');
  
} catch (error) {
  console.log('\n❌ FAILED! Cannot sign with this private key');
  console.log('   Error:', error.message);
  console.log('   Code:', error.code);
  
  console.log('\n🔧 SOLUTION:');
  console.log('   1. Go to Kalshi dashboard');
  console.log('   2. Delete the current API key');
  console.log('   3. Generate a NEW API key');
  console.log('   4. Download the .pem file (do NOT copy/paste)');
  console.log('   5. Run: cat downloaded-key.pem');
  console.log('   6. Copy the entire output (including headers)');
  console.log('   7. Run: vercel env rm KALSHI_PRIVATE_KEY production');
  console.log('   8. Run: vercel env add KALSHI_PRIVATE_KEY production');
  console.log('   9. Paste the key when prompted');
  
  process.exit(1);
}

