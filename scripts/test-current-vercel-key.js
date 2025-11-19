#!/usr/bin/env node

/**
 * Test if the current key in Vercel environment has hidden issues
 * This simulates what happens when the key is used
 */

const crypto = require('crypto');

console.log('🔍 Testing Current Vercel Key Format\n');

const key = process.env.KALSHI_PRIVATE_KEY;

if (!key) {
  console.error('❌ KALSHI_PRIVATE_KEY not set in environment');
  console.log('\nTo test:');
  console.log('  KALSHI_PRIVATE_KEY="your_key_here" node scripts/test-current-vercel-key.js');
  process.exit(1);
}

console.log('📊 Key Info:');
console.log(`  Length: ${key.length}`);
console.log(`  Has \\n: ${key.includes('\\n')}`);
console.log(`  Has actual newlines: ${key.includes('\n')}`);

// Check for problematic characters
const problematicChars = [];
for (let i = 0; i < key.length; i++) {
  const code = key.charCodeAt(i);
  // Check for non-ASCII or problematic unicode
  if (code > 127 || code === 0xFEFF || code === 0x200B) {
    problematicChars.push({
      char: key[i],
      code: code.toString(16),
      position: i
    });
  }
}

if (problematicChars.length > 0) {
  console.log('\n⚠️  Found problematic characters:');
  problematicChars.slice(0, 5).forEach(c => {
    console.log(`   Position ${c.position}: U+${c.code}`);
  });
  if (problematicChars.length > 5) {
    console.log(`   ... and ${problematicChars.length - 5} more`);
  }
  console.log('\n   This is likely from browser copy/paste!');
}

// Try to format and use it
let formattedKey = key;

// Handle escaped newlines
if (formattedKey.includes('\\n')) {
  formattedKey = formattedKey.replace(/\\n/g, '\n');
}

console.log('\n🧪 Testing cryptographic signing...');

try {
  const timestamp = Date.now().toString();
  const message = `${timestamp}GET/trade-api/v2/portfolio/balance`;
  
  const signer = crypto.createSign('SHA256');
  signer.update(message);
  signer.end();
  
  const signature = signer.sign(formattedKey, 'base64');
  
  console.log('✅ SUCCESS! Key works correctly!');
  console.log(`   Signature: ${signature.substring(0, 40)}...`);
  console.log('\nThe key format is correct. The issue might be elsewhere.');
  
} catch (error) {
  console.log('❌ FAILED! Key has issues.');
  console.log(`   Error: ${error.message}`);
  console.log(`   Code: ${error.code}`);
  
  if (error.code === 'ERR_OSSL_UNSUPPORTED') {
    console.log('\n💡 This is the same error as in your logs!');
    console.log('\n🔧 Solutions:');
    console.log('   1. Delete the key from Kalshi');
    console.log('   2. Generate a brand new key');
    console.log('   3. DOWNLOAD the .pem file (do NOT copy/paste from browser)');
    console.log('   4. Verify with: node scripts/verify-kalshi-key-length.js');
    console.log('   5. Format with: node scripts/format-kalshi-key.js');
    console.log('   6. Upload to Vercel');
  }
}

