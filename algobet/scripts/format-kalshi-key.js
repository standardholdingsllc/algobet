#!/usr/bin/env node

/**
 * Format Kalshi Private Key for Vercel Environment Variables
 * 
 * Usage:
 *   node scripts/format-kalshi-key.js "YOUR_RAW_KEY_HERE"
 * 
 * This will output the properly formatted key ready to paste into Vercel
 */

const rawKey = process.argv[2];

if (!rawKey) {
  console.error('❌ Error: Please provide the raw private key as an argument');
  console.log('\nUsage:');
  console.log('  node scripts/format-kalshi-key.js "YOUR_RAW_KEY_HERE"');
  console.log('\nOr paste your key when prompted:');
  process.exit(1);
}

function formatPrivateKey(key) {
  // Remove all whitespace
  let cleaned = key.replace(/\s+/g, '');
  
  // Remove existing headers if present
  cleaned = cleaned
    .replace(/-----BEGINPRIVATEKEY-----/g, '')
    .replace(/-----ENDPRIVATEKEY-----/g, '')
    .replace(/-----BEGINRSAPRIVATEKEY-----/g, '')
    .replace(/-----ENDRSAPRIVATEKEY-----/g, '');
  
  // Split into 64-character lines (standard for PEM format)
  const lines = [];
  for (let i = 0; i < cleaned.length; i += 64) {
    lines.push(cleaned.substring(i, i + 64));
  }
  
  // Add headers and join with \n
  const formatted = `-----BEGIN PRIVATE KEY-----\\n${lines.join('\\n')}\\n-----END PRIVATE KEY-----`;
  
  return formatted;
}

try {
  const formatted = formatPrivateKey(rawKey);
  
  console.log('✅ Formatted Private Key for Vercel:\n');
  console.log('Copy the text below (including quotes) and paste into Vercel environment variable:\n');
  console.log(formatted);
  console.log('\n');
  console.log('📋 Steps to update in Vercel:');
  console.log('1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables');
  console.log('2. Find KALSHI_PRIVATE_KEY and click Edit');
  console.log('3. Paste the formatted key above (the entire string with \\n)');
  console.log('4. Click Save');
  console.log('5. Redeploy your application');
} catch (error) {
  console.error('❌ Error formatting key:', error.message);
  process.exit(1);
}

