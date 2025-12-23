#!/usr/bin/env node

/**
 * Test and Validate Kalshi Private Key Format
 * 
 * This script tests if your Kalshi private key is correctly formatted
 * and can be used by Node.js crypto module.
 * 
 * Usage:
 *   node scripts/test-kalshi-key.js "YOUR_PRIVATE_KEY_HERE"
 * 
 * Or set KALSHI_PRIVATE_KEY environment variable:
 *   KALSHI_PRIVATE_KEY="..." node scripts/test-kalshi-key.js
 */

const crypto = require('crypto');

// Get key from argument or environment
let rawKey = process.argv[2] || process.env.KALSHI_PRIVATE_KEY;

if (!rawKey) {
  console.error('❌ Error: No private key provided');
  console.log('\nUsage:');
  console.log('  node scripts/test-kalshi-key.js "YOUR_PRIVATE_KEY"');
  console.log('  Or set KALSHI_PRIVATE_KEY environment variable');
  process.exit(1);
}

console.log('🔍 Testing Kalshi Private Key Format...\n');

// Step 1: Show raw key info
console.log('📊 Raw Key Info:');
console.log(`  Length: ${rawKey.length}`);
console.log(`  Has \\n: ${rawKey.includes('\\n')}`);
console.log(`  Has actual newlines: ${rawKey.includes('\n')}`);
console.log(`  Has BEGIN header: ${rawKey.includes('-----BEGIN')}`);
console.log(`  Has RSA: ${rawKey.includes('RSA')}`);

// Step 2: Format the key (same logic as the app)
function formatPrivateKey(key) {
  if (!key) return '';
  
  let formattedKey = key;

  // Handle escaped newlines
  if (formattedKey.includes('\\n')) {
    console.log('\n✅ Converting \\n to actual newlines');
    formattedKey = formattedKey.replace(/\\n/g, '\n');
  }
  
  // Handle single-line format
  if (formattedKey.includes('-----BEGIN') && !formattedKey.includes('\n')) {
    console.log('✅ Converting single-line format to multi-line');
    formattedKey = formattedKey
      .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, match => `${match}\n`)
      .replace(/-----END (RSA )?PRIVATE KEY-----/, match => `\n${match}`)
      .replace(/\s+/g, '\n');
  }

  // Add headers if missing
  if (!formattedKey.includes('-----BEGIN')) {
    console.log('✅ Adding missing headers');
    formattedKey = `-----BEGIN RSA PRIVATE KEY-----\n${formattedKey}\n-----END RSA PRIVATE KEY-----`;
  }

  // Try to convert RSA to PKCS#8
  if (formattedKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    console.log('⚙️  Attempting to convert RSA PRIVATE KEY to PRIVATE KEY (PKCS#8)...');
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
      console.log('✅ Successfully converted to PKCS#8 format');
    } catch (error) {
      console.log(`⚠️  Conversion failed: ${error.message}`);
      console.log('   Will try to use original format...');
    }
  }
  
  return formattedKey;
}

let formattedKey;
try {
  formattedKey = formatPrivateKey(rawKey);
} catch (error) {
  console.error('\n❌ Error formatting key:', error.message);
  process.exit(1);
}

// Step 3: Show formatted key info
const lines = formattedKey.split('\n');
console.log('\n📊 Formatted Key Info:');
console.log(`  Length: ${formattedKey.length}`);
console.log(`  Lines: ${lines.length}`);
console.log(`  Header: ${lines[0]}`);
console.log(`  Footer: ${lines[lines.length - 1]}`);
console.log(`  First data line: ${lines[1]?.substring(0, 40)}...`);

// Step 4: Test signing
console.log('\n🧪 Testing Cryptographic Signing...');

try {
  // Create a test message to sign (similar to Kalshi API)
  const timestamp = Date.now().toString();
  const method = 'GET';
  const path = '/trade-api/v2/portfolio/balance';
  const message = `${timestamp}${method}${path}`;
  
  console.log(`  Test message: ${message.substring(0, 50)}...`);
  
  // Try to sign
  const signer = crypto.createSign('SHA256');
  signer.update(message);
  signer.end();
  
  const signature = signer.sign(formattedKey, 'base64');
  
  console.log('✅ Signing successful!');
  console.log(`  Signature length: ${signature.length}`);
  console.log(`  Signature preview: ${signature.substring(0, 40)}...`);
  
  // Test verification (optional)
  console.log('\n🔐 Key Details:');
  try {
    const keyObject = crypto.createPrivateKey(formattedKey);
    const keyDetails = keyObject.asymmetricKeyDetails;
    console.log(`  Type: ${keyObject.asymmetricKeyType}`);
    if (keyDetails) {
      console.log(`  Modulus length: ${keyDetails.modulusLength} bits`);
    }
  } catch (e) {
    console.log('  (Could not extract key details)');
  }
  
  console.log('\n✅ SUCCESS! Your private key is correctly formatted and working.');
  console.log('\n📋 Next Steps:');
  console.log('1. Copy your formatted key to Vercel environment variables');
  console.log('2. Make sure to use the format with \\n (backslash-n) in Vercel');
  console.log('3. Redeploy your application');
  console.log('4. Test the bot again');
  
} catch (error) {
  console.error('\n❌ Signing failed!');
  console.error(`Error: ${error.message}`);
  console.error(`Code: ${error.code || 'N/A'}`);
  
  if (error.code === 'ERR_OSSL_UNSUPPORTED') {
    console.error('\n💡 This error means the key format is not supported by Node.js crypto.');
    console.error('Possible solutions:');
    console.error('1. The key might be password-protected (Kalshi keys should not be)');
    console.error('2. The key format might be corrupted');
    console.error('3. Try regenerating the key from Kalshi dashboard');
    console.error('4. Make sure you copied the ENTIRE key including all base64 content');
  }
  
  console.error('\n📝 Debug Info:');
  console.error(`  Formatted key starts with: ${formattedKey.substring(0, 50)}`);
  console.error(`  Formatted key ends with: ${formattedKey.substring(formattedKey.length - 50)}`);
  
  process.exit(1);
}

