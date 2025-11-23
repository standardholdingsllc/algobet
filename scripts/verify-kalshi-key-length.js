#!/usr/bin/env node

/**
 * Quick verification of Kalshi key length
 * Run this to check if your key is the right size before uploading to Vercel
 */

const readline = require('readline');

console.log('🔍 Kalshi Private Key Verification Tool\n');
console.log('This will check if your key is the correct length.');
console.log('A valid RSA-2048 key should be 1600-1900 characters.\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('Please paste your ENTIRE private key (including headers) and press Enter twice:\n');

let input = '';
let emptyLineCount = 0;

rl.on('line', (line) => {
  if (line.trim() === '') {
    emptyLineCount++;
    if (emptyLineCount >= 2) {
      rl.close();
    }
  } else {
    emptyLineCount = 0;
    input += line + '\n';
  }
});

rl.on('close', () => {
  if (!input.trim()) {
    console.error('\n❌ No input received');
    process.exit(1);
  }

  // Analyze the key
  const lines = input.trim().split('\n');
  const totalLength = input.length;
  
  console.log('\n📊 Analysis Results:\n');
  console.log(`  Total length: ${totalLength} characters`);
  console.log(`  Number of lines: ${lines.length}`);
  console.log(`  First line: ${lines[0]}`);
  console.log(`  Last line: ${lines[lines.length - 1]}`);
  
  // Check for issues
  let hasIssues = false;
  
  if (totalLength < 1600) {
    console.log('\n❌ ERROR: Key is TOO SHORT!');
    console.log(`   Expected: 1600-1900 characters`);
    console.log(`   Got: ${totalLength} characters`);
    console.log(`   Missing: ~${1600 - totalLength} characters`);
    console.log('\n   This key is INCOMPLETE or CORRUPTED.');
    hasIssues = true;
  } else if (totalLength > 2000) {
    console.log('\n⚠️  WARNING: Key is longer than expected');
    console.log('   This might include extra whitespace or data');
  } else {
    console.log('\n✅ Length is correct (1600-1900 chars)');
  }
  
  if (lines.length < 25) {
    console.log(`\n❌ ERROR: Too few lines!`);
    console.log(`   Expected: 25-30 lines`);
    console.log(`   Got: ${lines.length} lines`);
    console.log('\n   This key is INCOMPLETE.');
    hasIssues = true;
  } else if (lines.length > 35) {
    console.log(`\n⚠️  WARNING: More lines than expected`);
  } else {
    console.log(`✅ Line count is correct (25-30 lines)`);
  }
  
  if (!lines[0].includes('BEGIN') || !lines[0].includes('KEY')) {
    console.log('\n❌ ERROR: Missing or incorrect header');
    console.log(`   Expected: -----BEGIN [RSA] PRIVATE KEY-----`);
    console.log(`   Got: ${lines[0]}`);
    hasIssues = true;
  } else {
    console.log('✅ Header is present');
  }
  
  if (!lines[lines.length - 1].includes('END') || !lines[lines.length - 1].includes('KEY')) {
    console.log('\n❌ ERROR: Missing or incorrect footer');
    console.log(`   Expected: -----END [RSA] PRIVATE KEY-----`);
    console.log(`   Got: ${lines[lines.length - 1]}`);
    hasIssues = true;
  } else {
    console.log('✅ Footer is present');
  }
  
  // Final verdict
  if (hasIssues) {
    console.log('\n❌ VERDICT: This key has problems and will NOT work!');
    console.log('\n📋 What to do:');
    console.log('   1. Go back to Kalshi API settings');
    console.log('   2. DELETE this key');
    console.log('   3. Generate a BRAND NEW key');
    console.log('   4. DOWNLOAD the .pem file (don\'t copy/paste from browser)');
    console.log('   5. Run this verification tool again with the downloaded file');
    console.log('   6. Only upload to Vercel if this tool says ✅');
  } else {
    console.log('\n✅ VERDICT: This key looks good!');
    console.log('\n📋 Next steps:');
    console.log('   1. Use scripts/format-kalshi-key.js to format it for Vercel');
    console.log('   2. Copy the formatted output');
    console.log('   3. Paste into Vercel KALSHI_PRIVATE_KEY');
    console.log('   4. Also update KALSHI_API_KEY with the new key ID');
    console.log('   5. Save and redeploy');
  }
  
  process.exit(hasIssues ? 1 : 0);
});

console.log('(Paste your key and press Enter twice when done)\n');




