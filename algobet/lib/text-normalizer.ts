/**
 * Text Normalizer for Live Event Matching
 *
 * Generic text normalization for token-based event matching.
 * No hardcoded team aliases - uses stopword removal and tokenization
 * to enable scalable cross-platform matching.
 *
 * Key principles:
 * - Lowercase everything
 * - Remove sport keywords, generic words, platform boilerplate
 * - Keep meaningful tokens (team names, player names, etc.)
 * - Support sport-specific stopword lists for fine-tuning
 */

import { Sport } from '@/types/live-events';

// ============================================================================
// Stopword Lists
// ============================================================================

/**
 * Generic stopwords to remove from all event titles.
 * These are common across all sports and platforms.
 */
const GENERIC_STOPWORDS = new Set([
  // Separators and common words
  'vs', 'v', 'versus', 'at', 'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on',
  
  // Generic event terms
  'game', 'match', 'live', 'today', 'tonight', 'tomorrow', 'now',
  'round', 'week', 'day', 'final', 'finals', 'semifinal', 'quarterfinal',
  'series', 'season', 'regular', 'playoff', 'playoffs', 'postseason',
  'championship', 'tournament', 'cup', 'bowl',
  
  // Betting/market terms
  'moneyline', 'spread', 'total', 'over', 'under', 'prop', 'props',
  'winner', 'win', 'wins', 'will', 'beat', 'beats', 'defeat', 'defeats',
  'points', 'goals', 'score', 'scores', 'line', 'odds', 'bet', 'betting',
  'picks', 'pick', 'prediction', 'predictions',
  
  // Time/period terms
  'first', 'second', 'third', 'fourth', 'half', 'quarter', 'period',
  'inning', 'innings', 'set', 'sets', 'game', 'games',
  
  // Generic modifiers
  'home', 'away', 'most', 'least', 'any', 'all', 'each', 'every',
]);

/**
 * Sport keywords - these indicate sport type but aren't useful for matching
 */
const SPORT_KEYWORDS = new Set([
  // Major leagues
  'nba', 'nfl', 'nhl', 'mlb', 'mls',
  'epl', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'ucl', 'uefa',
  'ncaa', 'college', 'cfp', 'cfb', 'cbb',
  
  // Sports
  'basketball', 'football', 'hockey', 'baseball', 'soccer', 'futbol',
  'tennis', 'golf', 'boxing', 'mma', 'ufc', 'wrestling',
  
  // Esports
  'esports', 'esport', 'gaming',
  'cs2', 'csgo', 'dota', 'dota2', 'valorant', 'lol', 'overwatch',
  'league', 'legends', // "League of Legends"
  
  // Other
  'sports', 'sport', 'athletic', 'athletics',
]);

/**
 * Sport-specific stopwords for fine-tuning.
 * These tokens are common in a sport but not useful for distinguishing games.
 */
const SPORT_SPECIFIC_STOPWORDS: Partial<Record<Sport, Set<string>>> = {
  EPL: new Set(['fc', 'sc', 'cf', 'afc', 'united', 'city', 'club', 'town', 'wanderers', 'rovers', 'athletic']),
  LALIGA: new Set(['fc', 'cf', 'real', 'atletico', 'deportivo', 'club']),
  BUNDESLIGA: new Set(['fc', 'sc', 'sv', 'vfb', 'tsg', 'rb', 'bvb', 'borussia']),
  SERIEA: new Set(['fc', 'ac', 'as', 'ss', 'us', 'inter', 'juventus', 'roma', 'napoli', 'milan']),
  UCL: new Set(['fc', 'cf', 'sc', 'ac', 'club']),
  MLS: new Set(['fc', 'sc', 'cf', 'united', 'city', 'real', 'inter', 'sporting']),
  NCAA_FB: new Set(['state', 'university', 'college', 'tech', 'institute', 'am']),
  NCAA_BB: new Set(['state', 'university', 'college', 'tech', 'institute', 'am']),
};

/**
 * Platform-specific boilerplate patterns to remove
 */
const PLATFORM_BOILERPLATE_PATTERNS = [
  // Common betting market suffixes
  /\s*\(moneyline\)$/i,
  /\s*\(spread\)$/i,
  /\s*\(total[^)]*\)$/i,
  /\s*\(over\/under[^)]*\)$/i,
  /\s*-\s*moneyline$/i,
  /\s*-\s*spread$/i,
  /\s*-\s*total$/i,
  
  // Date patterns
  /\s*\(\d{1,2}\/\d{1,2}(\/\d{2,4})?\)$/,
  /\s*-\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?$/,
  
  // Time patterns
  /\s*@\s*\d{1,2}:\d{2}\s*(am|pm|et|pt|ct)?$/i,
  
  // Market type suffixes
  /\s*-\s*game\s*\d+$/i,
  /\s*game\s*\d+$/i,
];

// ============================================================================
// Normalization Options
// ============================================================================

export interface NormalizationOptions {
  /** Sport context for sport-specific stopword removal */
  sport?: Sport;
  
  /** Whether to remove sport keywords (default: true) */
  removeSportKeywords?: boolean;
  
  /** Minimum token length to keep (default: 2) */
  minTokenLength?: number;
  
  /** Additional stopwords to remove */
  additionalStopwords?: string[];
}

// ============================================================================
// Core Normalization Functions
// ============================================================================

/**
 * Normalize an event title into a normalized string and token array.
 * 
 * @param rawTitle The original event title from the vendor
 * @param opts Normalization options
 * @returns Object with normalizedTitle and tokens array
 */
export function normalizeEventTitle(
  rawTitle: string,
  opts?: NormalizationOptions
): {
  normalizedTitle: string;
  tokens: string[];
} {
  const options = {
    removeSportKeywords: true,
    minTokenLength: 2,
    ...opts,
  };

  // Step 1: Lowercase and trim
  let text = rawTitle.toLowerCase().trim();
  
  // Step 2: Remove platform boilerplate patterns
  for (const pattern of PLATFORM_BOILERPLATE_PATTERNS) {
    text = text.replace(pattern, '');
  }
  
  // Step 3: Handle @ and / as separators, then remove them
  // "Team A @ Team B" -> "Team A   Team B"
  text = text.replace(/\s*[@\/]\s*/g, '   ');
  
  // Step 4: Replace punctuation with spaces (but keep alphanumeric and hyphens within words)
  // Keep hyphens that are between word characters (like "team-spirit")
  text = text.replace(/[^\w\s-]/g, ' ');
  
  // Step 5: Collapse multiple spaces
  text = text.replace(/\s+/g, ' ').trim();
  
  // Step 6: Split into tokens
  let tokens = text.split(' ').filter(t => t.length > 0);
  
  // Step 7: Filter tokens
  const filteredTokens: string[] = [];
  const additionalStops = new Set(options.additionalStopwords?.map(s => s.toLowerCase()) || []);
  const sportStops = options.sport ? SPORT_SPECIFIC_STOPWORDS[options.sport] : undefined;
  
  for (const token of tokens) {
    // Skip if too short
    if (token.length < options.minTokenLength) continue;
    
    // Skip generic stopwords
    if (GENERIC_STOPWORDS.has(token)) continue;
    
    // Skip sport keywords if configured
    if (options.removeSportKeywords && SPORT_KEYWORDS.has(token)) continue;
    
    // Skip sport-specific stopwords
    if (sportStops?.has(token)) continue;
    
    // Skip additional stopwords
    if (additionalStops.has(token)) continue;
    
    filteredTokens.push(token);
  }
  
  return {
    normalizedTitle: filteredTokens.join(' '),
    tokens: filteredTokens,
  };
}

// ============================================================================
// Token Matching Score
// ============================================================================

export interface TokenMatchScore {
  /** Number of overlapping tokens (|A ∩ B|) */
  overlap: number;
  
  /** Coverage ratio: overlap / min(|A|, |B|) */
  coverage: number;
  
  /** Jaccard index: overlap / |A ∪ B| */
  jaccard: number;
}

/**
 * Calculate token overlap score between two token arrays.
 * Uses set semantics (unique tokens).
 * 
 * @param tokensA First token array
 * @param tokensB Second token array
 * @returns Token match score with overlap, coverage, and jaccard
 */
export function scoreTokenOverlap(
  tokensA: string[],
  tokensB: string[]
): TokenMatchScore {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  
  // Calculate intersection
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      overlap++;
    }
  }
  
  // Calculate coverage (overlap / min size)
  const minLen = Math.min(setA.size, setB.size);
  const coverage = minLen > 0 ? overlap / minLen : 0;
  
  // Calculate Jaccard (overlap / union size)
  const unionSize = setA.size + setB.size - overlap;
  const jaccard = unionSize > 0 ? overlap / unionSize : 0;
  
  return { overlap, coverage, jaccard };
}

/**
 * Check if two token arrays match based on config thresholds.
 * 
 * @param tokensA First token array
 * @param tokensB Second token array
 * @param minOverlap Minimum overlapping tokens required
 * @param minCoverage Minimum coverage ratio required
 * @returns True if tokens match, false otherwise
 */
export function tokensMatch(
  tokensA: string[],
  tokensB: string[],
  minOverlap: number,
  minCoverage: number
): boolean {
  const score = scoreTokenOverlap(tokensA, tokensB);
  return score.overlap >= minOverlap && score.coverage >= minCoverage;
}

// ============================================================================
// Time Bucketing
// ============================================================================

/**
 * Get the time bucket for a given timestamp.
 * Events in the same or adjacent buckets can potentially match.
 * 
 * @param startTime Event start time (epoch ms)
 * @param toleranceMs Time tolerance for matching (typically 15 minutes)
 * @returns Bucket number
 */
export function getTimeBucket(startTime: number, toleranceMs: number): number {
  return Math.round(startTime / toleranceMs);
}

/**
 * Check if two time buckets are within matching range.
 * Events must be in the same bucket or adjacent buckets.
 * 
 * @param bucket1 First time bucket
 * @param bucket2 Second time bucket
 * @returns True if within range, false otherwise
 */
export function timeBucketsMatch(bucket1: number, bucket2: number): boolean {
  return Math.abs(bucket1 - bucket2) <= 1;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the intersection of tokens from multiple events.
 * Useful for generating eventKey from matched events.
 * 
 * @param tokenArrays Array of token arrays from different events
 * @returns Sorted array of tokens that appear in majority of events
 */
export function getCommonTokens(tokenArrays: string[][]): string[] {
  if (tokenArrays.length === 0) return [];
  if (tokenArrays.length === 1) return [...tokenArrays[0]].sort();
  
  // Count token occurrences
  const tokenCounts = new Map<string, number>();
  for (const tokens of tokenArrays) {
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    }
  }
  
  // Keep tokens that appear in majority (>50%) of events
  const threshold = tokenArrays.length / 2;
  const commonTokens: string[] = [];
  for (const [token, count] of tokenCounts) {
    if (count > threshold) {
      commonTokens.push(token);
    }
  }
  
  return commonTokens.sort();
}

/**
 * Generate a slug from tokens for use in eventKey.
 * 
 * @param tokens Token array
 * @param maxTokens Maximum tokens to include (default: 4)
 * @returns Underscore-separated slug
 */
export function tokensToSlug(tokens: string[], maxTokens: number = 4): string {
  return tokens.slice(0, maxTokens).join('_');
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

/**
 * Parse teams from a title string using token-based approach.
 * This is a simpler version that doesn't rely on alias maps.
 * 
 * @param rawTitle The event title
 * @param sport Optional sport context
 * @returns Object with teams array and optional home/away
 */
export function parseTeamsFromTitleTokens(
  rawTitle: string,
  sport?: Sport
): {
  teams: string[];
  home?: string;
  away?: string;
} {
  // Check for @ separator (indicates away @ home format)
  const lowerRaw = rawTitle.toLowerCase();
  const atSep = lowerRaw.includes(' @ ') || lowerRaw.includes(' at ');
  
  const { tokens } = normalizeEventTitle(rawTitle, { sport });
  
  if (atSep && tokens.length >= 2) {
    // For "Away @ Home" format, try to split
    const atIndex = lowerRaw.indexOf(' @ ') !== -1 
      ? lowerRaw.indexOf(' @ ') 
      : lowerRaw.indexOf(' at ');
    
    const beforeAt = rawTitle.substring(0, atIndex);
    const afterAt = rawTitle.substring(atIndex + (lowerRaw.indexOf(' @ ') !== -1 ? 3 : 4));
    
    const awayTokens = normalizeEventTitle(beforeAt, { sport }).tokens;
    const homeTokens = normalizeEventTitle(afterAt, { sport }).tokens;
    
    return {
      teams: tokens,
      away: awayTokens.join(' '),
      home: homeTokens.join(' '),
    };
  }
  
  // Try to split on 'vs' or similar
  const vsMatch = rawTitle.match(/(.+?)\s+(?:vs\.?|v\.?|versus)\s+(.+)/i);
  if (vsMatch) {
    const team1Tokens = normalizeEventTitle(vsMatch[1], { sport }).tokens;
    const team2Tokens = normalizeEventTitle(vsMatch[2], { sport }).tokens;
    
    return {
      teams: tokens,
      home: team1Tokens.join(' '),
      away: team2Tokens.join(' '),
    };
  }
  
  return { teams: tokens };
}


