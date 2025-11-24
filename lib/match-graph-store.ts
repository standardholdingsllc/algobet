import { promises as fs } from 'fs';
import path from 'path';
import { Redis } from '@upstash/redis';
import { MatchGraph } from '@/types';
import {
  MATCH_GRAPH_FILE_NAME,
  MATCH_GRAPH_KV_KEY,
  MATCH_GRAPH_TTL_SECONDS,
  MATCH_GRAPH_VERSION,
} from './constants';

export type MatchGraphSource = 'redis' | 'disk';

export interface MatchGraphLoadResult {
  graph: MatchGraph | null;
  source?: MatchGraphSource;
  reason?: string;
}

export interface MatchGraphLoadOptions {
  maxAgeMs?: number;
}

const DEFAULT_MATCH_GRAPH_DIR = path.join(process.cwd(), 'data');
const TMP_MATCH_GRAPH_DIR = '/tmp/match-graph';

const preferredDirs: string[] = [];

if (process.env.MATCH_GRAPH_DIR) {
  preferredDirs.push(process.env.MATCH_GRAPH_DIR);
}

if (process.env.VERCEL) {
  preferredDirs.push(TMP_MATCH_GRAPH_DIR);
}

preferredDirs.push(DEFAULT_MATCH_GRAPH_DIR);

let resolvedDir: string | null = null;
let resolvingPromise: Promise<string | null> | null = null;
let warnedDir = false;

const redisClient =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      })
    : null;
let redisWarningEmitted = false;

async function resolveMatchGraphDir(): Promise<string | null> {
  if (resolvedDir !== null || warnedDir) {
    return resolvedDir;
  }

  if (resolvingPromise) {
    return resolvingPromise;
  }

  resolvingPromise = (async () => {
    for (const candidate of preferredDirs) {
      try {
        await fs.mkdir(candidate, { recursive: true });
        resolvedDir = candidate;
        warnedDir = false;
        console.info(`[MatchGraph] Using directory ${candidate}`);
        return candidate;
      } catch (error: any) {
        const code = error?.code;
        if (code === 'EROFS' || code === 'EACCES' || code === 'ENOTDIR') {
          console.warn(
            `[MatchGraph] Cannot write to ${candidate} (${code}). Trying next option...`
          );
          continue;
        }
        console.warn(
          `[MatchGraph] Failed to prepare directory (${code ?? 'unknown'}). Graph persistence disabled for this process.`
        );
        warnedDir = true;
        resolvedDir = null;
        return null;
      }
    }
    console.warn(
      '[MatchGraph] No writable directory available; graph persistence disabled for this process.'
    );
    warnedDir = true;
    resolvedDir = null;
    return null;
  })();

  const dir = await resolvingPromise;
  resolvingPromise = null;
  return dir;
}

function validateMatchGraph(graph: MatchGraph): string[] {
  const errors: string[] = [];
  if (!graph) {
    errors.push('Graph is empty');
    return errors;
  }
  if (typeof graph.version !== 'number') {
    errors.push('version must be numeric');
  }
  if (!graph.generatedAt || Number.isNaN(Date.parse(graph.generatedAt))) {
    errors.push('generatedAt must be a valid ISO timestamp');
  }
  if (!Array.isArray(graph.clusters)) {
    errors.push('clusters must be an array');
  }
  if (!Array.isArray(graph.edges)) {
    errors.push('edges must be an array');
  }
  return errors;
}

function describeStaleness(graph: MatchGraph, maxAgeMs?: number): string | null {
  if (!maxAgeMs) {
    return null;
  }
  const generated = Date.parse(graph.generatedAt);
  if (Number.isNaN(generated)) {
    return 'generatedAt timestamp is invalid';
  }
  const age = Date.now() - generated;
  if (age > maxAgeMs) {
    return `graph is older than ${Math.round(age / 1000)} seconds (limit ${
      maxAgeMs / 1000
    } seconds)`;
  }
  return null;
}

async function writeGraphToDisk(graph: MatchGraph): Promise<void> {
  const dir = await resolveMatchGraphDir();
  if (!dir) {
    return;
  }

  const filePath = path.join(dir, MATCH_GRAPH_FILE_NAME);
  await fs.writeFile(filePath, JSON.stringify(graph, null, 2), 'utf-8');
  const relativePath = path.relative(process.cwd(), filePath);
  console.info(
    `[MatchGraph] Wrote ${graph.clusters.length} clusters / ${graph.edges.length} edges to ${relativePath}`
  );
}

async function writeGraphToRedis(graph: MatchGraph): Promise<void> {
  if (!redisClient) {
    if (!redisWarningEmitted) {
      console.warn('[MatchGraph] Upstash credentials not set; skipping Redis persistence.');
      redisWarningEmitted = true;
    }
    return;
  }

  try {
    await redisClient.set(MATCH_GRAPH_KV_KEY, graph, {
      ex: MATCH_GRAPH_TTL_SECONDS,
    });
  } catch (error: any) {
    console.warn('[MatchGraph] Failed to persist graph to Upstash:', error?.message || error);
  }
}

async function readGraphFromRedis(): Promise<MatchGraphLoadResult> {
  if (!redisClient) {
    return {
      graph: null,
      reason: 'Upstash credentials not configured',
    };
  }
  try {
    const graph = await redisClient.get<MatchGraph>(MATCH_GRAPH_KV_KEY);
    if (!graph) {
      return { graph: null, reason: 'No graph stored in Redis' };
    }
    const errors = validateMatchGraph(graph);
    if (errors.length) {
      return {
        graph: null,
        reason: `Invalid graph in Redis: ${errors.join('; ')}`,
      };
    }
    return { graph, source: 'redis' };
  } catch (error: any) {
    return {
      graph: null,
      reason: error?.message || String(error),
    };
  }
}

async function readGraphFromDisk(): Promise<MatchGraphLoadResult> {
  const dir = await resolveMatchGraphDir();
  if (!dir) {
    return {
      graph: null,
      reason: 'No writable match-graph directory configured',
    };
  }
  const filePath = path.join(dir, MATCH_GRAPH_FILE_NAME);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const graph = JSON.parse(raw) as MatchGraph;
    const errors = validateMatchGraph(graph);
    if (errors.length) {
      return {
        graph: null,
        reason: `Invalid graph on disk: ${errors.join('; ')}`,
      };
    }
    return { graph, source: 'disk' };
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return {
        graph: null,
        reason: `No graph file at ${filePath}`,
      };
    }
    return {
      graph: null,
      reason: error?.message || String(error),
    };
  }
}

export async function saveMatchGraph(graph: MatchGraph): Promise<MatchGraph> {
  const normalizedGraph: MatchGraph = {
    ...graph,
    version: graph.version ?? MATCH_GRAPH_VERSION,
    generatedAt: graph.generatedAt ?? new Date().toISOString(),
  };

  const errors = validateMatchGraph(normalizedGraph);
  if (errors.length) {
    throw new Error(`[MatchGraph] Refusing to persist invalid graph: ${errors.join('; ')}`);
  }

  await Promise.all([writeGraphToDisk(normalizedGraph), writeGraphToRedis(normalizedGraph)]);
  return normalizedGraph;
}

export async function loadMatchGraph(
  options: MatchGraphLoadOptions = {}
): Promise<MatchGraphLoadResult> {
  const redisResult = await readGraphFromRedis();
  if (redisResult.graph) {
    const staleReason = describeStaleness(redisResult.graph, options.maxAgeMs);
    if (!staleReason) {
      return redisResult;
    }
    console.warn(`[MatchGraph] Redis graph stale: ${staleReason}`);
  } else if (redisResult.reason) {
    console.warn(`[MatchGraph] Redis load skipped: ${redisResult.reason}`);
  }

  const diskResult = await readGraphFromDisk();
  if (diskResult.graph) {
    const staleReason = describeStaleness(diskResult.graph, options.maxAgeMs);
    if (!staleReason) {
      return diskResult;
    }
    console.warn(`[MatchGraph] Disk graph stale: ${staleReason}`);
    return { graph: diskResult.graph, source: 'disk', reason: staleReason };
  }

  if (diskResult.reason) {
    console.warn(`[MatchGraph] Disk load skipped: ${diskResult.reason}`);
  }
  return { graph: null, reason: 'No match graph available' };
}

