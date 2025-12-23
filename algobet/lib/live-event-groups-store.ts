/**
 * Live Event Groups Store
 *
 * Persists MatchedEventGroups to a dynamic JSON file for:
 * - Debugging and inspection
 * - Cross-process visibility (when running separate workers)
 * - Backup/recovery
 *
 * File locations:
 * - Production/Vercel: /tmp/live-event-groups.json
 * - Local dev: data/live-event-groups.json (fallback)
 *
 * Writes are atomic (write to temp file then rename) to prevent partial reads.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MatchedEventGroup, LiveEventMatcherConfig } from '@/types/live-events';

// ============================================================================
// File Paths
// ============================================================================

/** Get the appropriate file path based on environment */
function getFilePath(): string {
  // Check if running on Vercel (read-only filesystem except /tmp)
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return '/tmp/live-event-groups.json';
  }
  
  // Local development - use data directory
  const dataDir = path.join(process.cwd(), 'data');
  
  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  return path.join(dataDir, 'live-event-groups.json');
}

/** Get temp file path for atomic writes */
function getTempFilePath(): string {
  const mainPath = getFilePath();
  return mainPath + '.tmp';
}

// ============================================================================
// File Data Structure
// ============================================================================

export interface LiveEventGroupsFileData {
  /** ISO timestamp when this file was generated */
  generatedAt: string;
  
  /** Configuration used for matching */
  config: {
    timeToleranceMs: number;
    minPlatforms: number;
    sportsOnly: boolean;
    preGameWindowMs: number;
    postGameWindowMs: number;
  };
  
  /** Summary stats */
  summary: {
    totalGroups: number;
    liveGroups: number;
    preGroups: number;
    threeWayMatches: number;
    twoWayMatches: number;
    bySport: Record<string, number>;
    byPlatformCount: Record<string, number>;
  };
  
  /** The matched event groups */
  groups: MatchedEventGroup[];
}

// ============================================================================
// Save/Load Functions
// ============================================================================

/**
 * Save matched event groups to the dynamic JSON file.
 * Uses atomic write (temp file + rename) to prevent partial reads.
 */
export function saveMatchedGroupsToFile(
  groups: MatchedEventGroup[],
  config: LiveEventMatcherConfig
): boolean {
  try {
    const filePath = getFilePath();
    const tempPath = getTempFilePath();
    
    // Build summary stats
    const liveGroups = groups.filter(g => g.status === 'LIVE').length;
    const preGroups = groups.filter(g => g.status === 'PRE').length;
    const threeWayMatches = groups.filter(g => g.platformCount >= 3).length;
    const twoWayMatches = groups.filter(g => g.platformCount === 2).length;
    
    const bySport: Record<string, number> = {};
    const byPlatformCount: Record<string, number> = {};
    
    for (const group of groups) {
      bySport[group.sport] = (bySport[group.sport] || 0) + 1;
      const key = `${group.platformCount}`;
      byPlatformCount[key] = (byPlatformCount[key] || 0) + 1;
    }
    
    const data: LiveEventGroupsFileData = {
      generatedAt: new Date().toISOString(),
      config: {
        timeToleranceMs: config.timeTolerance,
        minPlatforms: config.minPlatforms,
        sportsOnly: config.sportsOnly,
        preGameWindowMs: config.preGameWindow,
        postGameWindowMs: config.postGameWindow,
      },
      summary: {
        totalGroups: groups.length,
        liveGroups,
        preGroups,
        threeWayMatches,
        twoWayMatches,
        bySport,
        byPlatformCount,
      },
      groups,
    };
    
    // Write to temp file first
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(tempPath, json, 'utf-8');
    
    // Atomic rename
    fs.renameSync(tempPath, filePath);
    
    return true;
  } catch (error) {
    console.error('[LiveEventGroupsStore] Error saving to file:', error);
    
    // Clean up temp file if it exists
    try {
      const tempPath = getTempFilePath();
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    
    return false;
  }
}

/**
 * Load matched event groups from the JSON file.
 * Returns null on any error (file missing, parse error, etc.)
 */
export function loadMatchedGroupsFromFile(): MatchedEventGroup[] | null {
  try {
    const filePath = getFilePath();
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as LiveEventGroupsFileData;
    
    // Basic validation
    if (!data.groups || !Array.isArray(data.groups)) {
      console.warn('[LiveEventGroupsStore] Invalid file format: missing groups array');
      return null;
    }
    
    return data.groups;
  } catch (error) {
    console.error('[LiveEventGroupsStore] Error loading from file:', error);
    return null;
  }
}

/**
 * Load the full file data including config and summary
 */
export function loadMatchedGroupsFileData(): LiveEventGroupsFileData | null {
  try {
    const filePath = getFilePath();
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as LiveEventGroupsFileData;
    
    // Basic validation
    if (!data.generatedAt || !data.groups) {
      console.warn('[LiveEventGroupsStore] Invalid file format');
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('[LiveEventGroupsStore] Error loading file data:', error);
    return null;
  }
}

/**
 * Get file info without loading the full content
 */
export function getMatchedGroupsFileInfo(): {
  exists: boolean;
  path: string;
  modifiedAt?: Date;
  size?: number;
} {
  const filePath = getFilePath();
  
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false, path: filePath };
    }
    
    const stats = fs.statSync(filePath);
    return {
      exists: true,
      path: filePath,
      modifiedAt: stats.mtime,
      size: stats.size,
    };
  } catch {
    return { exists: false, path: filePath };
  }
}

/**
 * Delete the matched groups file (for testing/cleanup)
 */
export function deleteMatchedGroupsFile(): boolean {
  try {
    const filePath = getFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('[LiveEventGroupsStore] Error deleting file:', error);
    return false;
  }
}


