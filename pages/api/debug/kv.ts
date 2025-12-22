/**
 * KV Probe Debug Endpoint
 *
 * GET /api/debug/kv
 *
 * Returns diagnostic information about KV connectivity.
 * Only enabled when DEBUG_STATUS=1 environment variable is set.
 * 
 * This endpoint helps debug environment mismatches between DO worker and Vercel:
 * - Confirms which Upstash host Vercel is connecting to
 * - Shows the exact key being read
 * - Indicates whether the heartbeat exists and when it was last updated
 * 
 * SECURITY: Never returns full URLs or tokens - only hostname and key names.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getWorkerHeartbeatWithDiagnostics,
  getLiveEventsSnapshot,
  getKvConfigDiagnostics,
  isKvConfigured,
  WORKER_HEARTBEAT_KEY,
  LIVE_EVENTS_SNAPSHOT_KEY,
} from '@/lib/kv-storage';

interface KVProbeResponse {
  enabled: boolean;
  message?: string;
  kv: {
    configured: boolean;
    kvHost: string | null;
    isVercel: boolean;
    vercelRegion?: string;
  };
  heartbeat: {
    key: string;
    exists: boolean;
    readResult: string;
    updatedAt: string | null;
    ageMs: number | null;
    state: string | null;
    error?: string;
    rawSample?: string;
  };
  snapshot: {
    key: string;
    exists: boolean;
    updatedAt: string | null;
    ageMs: number | null;
    totalEvents: number | null;
  };
  timestamp: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<KVProbeResponse>
) {
  // Disable caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method !== 'GET') {
    return res.status(405).json({
      enabled: false,
      message: 'Method not allowed',
      kv: { configured: false, kvHost: null, isVercel: false },
      heartbeat: { key: WORKER_HEARTBEAT_KEY, exists: false, readResult: 'error', updatedAt: null, ageMs: null, state: null },
      snapshot: { key: LIVE_EVENTS_SNAPSHOT_KEY, exists: false, updatedAt: null, ageMs: null, totalEvents: null },
      timestamp: new Date().toISOString(),
    });
  }

  // Check if debug mode is enabled
  const debugEnabled = process.env.DEBUG_STATUS === '1' || req.query.force === '1';

  if (!debugEnabled) {
    return res.status(403).json({
      enabled: false,
      message: 'Debug endpoint disabled. Set DEBUG_STATUS=1 environment variable to enable.',
      kv: { configured: isKvConfigured(), kvHost: null, isVercel: Boolean(process.env.VERCEL) },
      heartbeat: { key: WORKER_HEARTBEAT_KEY, exists: false, readResult: 'disabled', updatedAt: null, ageMs: null, state: null },
      snapshot: { key: LIVE_EVENTS_SNAPSHOT_KEY, exists: false, updatedAt: null, ageMs: null, totalEvents: null },
      timestamp: new Date().toISOString(),
    });
  }

  const now = Date.now();
  const kvConfig = getKvConfigDiagnostics();

  // Read heartbeat with diagnostics
  const { heartbeat, diagnostics } = await getWorkerHeartbeatWithDiagnostics();
  const heartbeatAge = heartbeat?.updatedAt
    ? now - new Date(heartbeat.updatedAt).getTime()
    : null;

  // Read snapshot
  const snapshot = await getLiveEventsSnapshot();
  const snapshotAge = snapshot?.updatedAt
    ? now - new Date(snapshot.updatedAt).getTime()
    : null;

  const response: KVProbeResponse = {
    enabled: true,
    kv: {
      configured: kvConfig.configured,
      kvHost: kvConfig.kvHost,
      isVercel: kvConfig.isVercel,
      vercelRegion: kvConfig.vercelRegion,
    },
    heartbeat: {
      key: WORKER_HEARTBEAT_KEY,
      exists: heartbeat !== null,
      readResult: diagnostics.kvReadResult,
      updatedAt: heartbeat?.updatedAt ?? null,
      ageMs: heartbeatAge,
      state: heartbeat?.state ?? null,
      error: diagnostics.kvError,
      rawSample: diagnostics.kvRawSample,
    },
    snapshot: {
      key: LIVE_EVENTS_SNAPSHOT_KEY,
      exists: snapshot !== null,
      updatedAt: snapshot?.updatedAt ?? null,
      ageMs: snapshotAge,
      totalEvents: snapshot?.registry?.totalEvents ?? null,
    },
    timestamp: new Date().toISOString(),
  };

  return res.status(200).json(response);
}

