#!/usr/bin/env node
/**
 * Verifies that buildKalshiAuthHeaders can sign the Kalshi WebSocket path.
 * Uses an in-memory RSA key so no real credentials are required.
 */

import { generateKeyPairSync } from 'crypto';
import {
  buildKalshiAuthHeaders,
  KALSHI_WS_SIGNATURE_PATH,
} from '../lib/markets/kalshi';

async function main(): Promise<void> {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const privateKeyPem = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();

  process.env.KALSHI_API_KEY = 'test-api-key';
  process.env.KALSHI_PRIVATE_KEY = privateKeyPem;

  const headers = await buildKalshiAuthHeaders('GET', KALSHI_WS_SIGNATURE_PATH);

  const requiredKeys = [
    'KALSHI-ACCESS-KEY',
    'KALSHI-ACCESS-SIGNATURE',
    'KALSHI-ACCESS-TIMESTAMP',
  ];

  for (const key of requiredKeys) {
    if (!headers[key]) {
      throw new Error(`Missing header ${key}`);
    }
  }

  if (headers['KALSHI-ACCESS-KEY'] !== 'test-api-key') {
    throw new Error('API key was not propagated to headers');
  }

  console.log('✅ Kalshi WS auth headers generated successfully');
}

main().catch((error) => {
  console.error('❌ Kalshi WS auth header test failed:', error);
  process.exit(1);
});

