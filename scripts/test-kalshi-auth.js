#!/usr/bin/env node

/**
 * Test Kalshi authentication locally
 * This simulates exactly what happens in production
 */

const crypto = require('crypto');
const axios = require('axios');

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const API_KEY = process.env.KALSHI_API_KEY;
const PRIVATE_KEY_RAW = process.env.KALSHI_PRIVATE_KEY;

if (!API_KEY || !PRIVATE_KEY_RAW) {
  console.error('❌ Missing environment variables');
  console.log('Usage:');
  console.log('  KALSHI_API_KEY="your-key" KALSHI_PRIVATE_KEY="your-private-key" node scripts/test-kalshi-auth.js');
  process.exit(1);
}

console.log('🔍 Testing Kalshi Authentication\n');
console.log('API Key:', API_KEY);
console.log('Private Key Length:', PRIVATE_KEY_RAW.length, 'chars\n');

// Format the private key (same logic as in the app)
function formatPrivateKey(key) {
  if (!key) return '';
  
  let formattedKey = key;

  // Handle escaped newlines
  if (formattedKey.includes('\\n')) {
    console.log('✓ Converting \\n to actual newlines');
    formattedKey = formattedKey.replace(/\\n/g, '\n');
  }
  
  // Handle single-line format
  if (formattedKey.includes('-----BEGIN') && !formattedKey.includes('\n')) {
    console.log('✓ Converting single-line to multi-line');
    formattedKey = formattedKey
      .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, match => `${match}\n`)
      .replace(/-----END (RSA )?PRIVATE KEY-----/, match => `\n${match}`)
      .replace(/\s+/g, '\n');
  }

  // Add headers if missing
  if (!formattedKey.includes('-----BEGIN')) {
    console.log('✓ Adding headers');
    formattedKey = `-----BEGIN RSA PRIVATE KEY-----\n${formattedKey}\n-----END RSA PRIVATE KEY-----`;
  }

  // Try to convert RSA to PKCS#8
  if (formattedKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    console.log('⚙️  Attempting RSA → PKCS#8 conversion...');
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
      console.log('✅ Converted to PKCS#8 format\n');
    } catch (error) {
      console.log(`⚠️  Conversion failed: ${error.message}`);
      console.log('   Using RSA format as-is\n');
    }
  }
  
  return formattedKey;
}

async function testAuthentication() {
  const privateKey = formatPrivateKey(PRIVATE_KEY_RAW);
  
  console.log('📊 Formatted Key Info:');
  const lines = privateKey.split('\n');
  console.log('  Lines:', lines.length);
  console.log('  Header:', lines[0]);
  console.log('  Footer:', lines[lines.length - 1]);
  console.log();
  
  // Generate auth headers (same logic as app)
  const timestamp = Date.now().toString();
  const method = 'GET';
  const path = '/trade-api/v2/portfolio/balance';
  // CRITICAL: For GET requests, body MUST be empty string (not included in message)
  const bodyString = ''; // Empty for GET requests
  const message = `${timestamp}${method}${path}${bodyString}`;
  
  console.log('🔐 Signing Message:');
  console.log('  Timestamp:', timestamp);
  console.log('  Method:', method);
  console.log('  Path:', path);
  console.log('  Body:', bodyString === '' ? '(empty string)' : bodyString);
  console.log('  Full Message:', message.substring(0, 50) + '...\n');
  
  try {
    const signer = crypto.createSign('SHA256');
    signer.update(message);
    signer.end();
    
    const signature = signer.sign(privateKey, 'base64');
    
    console.log('✅ Signature Generated:');
    console.log('  ', signature.substring(0, 60) + '...\n');
    
    // Make actual API call
    console.log('🌐 Making API Request to Kalshi...\n');
    
    // NOTE: No Content-Type header for GET requests (no body)
    const headers = {
      'KALSHI-ACCESS-KEY': API_KEY,
      'KALSHI-ACCESS-SIGNATURE': signature,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
    };
    
    const response = await axios.get(`${BASE_URL}/portfolio/balance`, { headers });
    
    console.log('✅ SUCCESS! Authentication worked!');
    console.log('Balance:', response.data.balance / 100, 'USD');
    console.log('\nYour Kalshi credentials are working correctly! 🎉');
    
  } catch (error) {
    console.log('❌ FAILED! Authentication error\n');
    
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Response:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 401) {
        console.log('\n💡 401 Unauthorized - Common Causes:');
        console.log('   1. ❌ API key is REVOKED (most likely if exposed in logs)');
        console.log('   2. ❌ Signature format is wrong');
        console.log('   3. ❌ API key doesn\'t match the private key');
        console.log('   4. ❌ Timestamp is too far off (>5 seconds from server time)');
        console.log('   5. ❌ Body serialization issue (must be empty string for GET)');
        console.log('\n🔧 Fix:');
        console.log('   - REGENERATE API KEY in Kalshi dashboard (if exposed in logs)');
        console.log('   - Verify the private key matches that API Key');
        console.log('   - Check system clock is accurate');
        console.log('   - Ensure body is empty string "" for GET requests');
      }
    } else {
      console.log('Error:', error.message);
    }
    
    process.exit(1);
  }
}

testAuthentication();

