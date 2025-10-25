/**
 * Sophisticated market matching across prediction market platforms
 * 
 * Handles variations in:
 * - Wording ("Dodgers vs Yankees" vs "Yankees v Dodgers")
 * - Dates ("October 31st" vs "Oct 31" vs "10/31/2024")
 * - Abbreviations ("Bitcoin" vs "BTC", "Federal Reserve" vs "Fed")
 * - Numbers ("70°F" vs "70 degrees" vs "70F")
 * - Opposing outcomes ("above 70" vs "below 70" - need to flip sides)
 */

import { Market } from '@/types';

interface ParsedMarket {
  entities: string[];      // Key entities (teams, stocks, people, places)
  dates: Date[];          // Extracted dates
  numbers: number[];      // Extracted numbers/thresholds
  metric?: string;        // What's being measured (price, temperature, score)
  direction?: 'above' | 'below' | 'between' | 'equals' | 'wins' | 'loses';
  category: string;       // Market category
  normalizedTitle: string;
  original: Market;
}

/**
 * Entity normalization mappings
 * Maps common variations to canonical forms
 */
const ENTITY_MAPPINGS: Record<string, string> = {
  // Crypto
  'btc': 'bitcoin',
  'eth': 'ethereum',
  'cryptocurrency': 'crypto',
  
  // Sports teams (examples - expand as needed)
  'dodgers': 'los angeles dodgers',
  'yankees': 'new york yankees',
  'lakers': 'los angeles lakers',
  'celtics': 'boston celtics',
  
  // Organizations
  'fed': 'federal reserve',
  'sec': 'securities and exchange commission',
  'irs': 'internal revenue service',
  
  // People (add as markets appear)
  'biden': 'joe biden',
  'trump': 'donald trump',
  
  // Measurements
  'degrees': 'temperature',
  'fahrenheit': 'temperature',
  'celsius': 'temperature',
  '°f': 'temperature',
  '°c': 'temperature',
  
  // Financial
  'stock': 'share price',
  'nasdaq': 'nasdaq index',
  'sp500': 's&p 500',
  's&p500': 's&p 500',
  
  // Time periods
  'eod': 'end of day',
  'eom': 'end of month',
  'eoy': 'end of year',
};

/**
 * Month name mappings for date parsing
 */
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

const MONTH_ABBR = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
];

/**
 * Parse and extract structured data from market title
 */
export function parseMarket(market: Market): ParsedMarket {
  const title = market.title.toLowerCase();
  const expiryDate = new Date(market.expiryDate);
  
  return {
    entities: extractEntities(title),
    dates: extractDates(title, expiryDate),
    numbers: extractNumbers(title),
    metric: extractMetric(title),
    direction: extractDirection(title),
    category: market.platform, // Could be more sophisticated
    normalizedTitle: normalizeTitle(title),
    original: market,
  };
}

/**
 * Extract key entities (teams, companies, people, places)
 * Uses NER-like patterns
 */
function extractEntities(title: string): string[] {
  const entities: Set<string> = new Set();
  
  // Remove common words to focus on entities
  const stopWords = new Set([
    'will', 'the', 'be', 'on', 'at', 'in', 'by', 'to', 'of', 'for',
    'and', 'or', 'a', 'an', 'is', 'are', 'was', 'were', 'have', 'has',
    'above', 'below', 'between', 'over', 'under', 'more', 'less', 'than',
    'price', 'close', 'open', 'high', 'low', 'vs', 'versus', 'against'
  ]);
  
  const words = title.split(/\s+/);
  
  // Extract capitalized sequences (proper nouns)
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!stopWords.has(word) && word.length > 2) {
      // Apply entity mappings
      const normalized = ENTITY_MAPPINGS[word] || word;
      entities.add(normalized);
    }
  }
  
  // Extract known patterns
  
  // Team names (often contain city + team name)
  const teamPattern = /([\w\s]+)\s+(vs|versus|v|against)\s+([\w\s]+)/i;
  const teamMatch = title.match(teamPattern);
  if (teamMatch) {
    entities.add(teamMatch[1].trim());
    entities.add(teamMatch[3].trim());
  }
  
  // Stock tickers ($AAPL, AAPL)
  const tickerPattern = /\$?([A-Z]{1,5})\b/g;
  const tickerMatches = title.match(tickerPattern);
  if (tickerMatches) {
    tickerMatches.forEach(ticker => entities.add(ticker.replace('$', '').toLowerCase()));
  }
  
  // Crypto symbols (BTC, ETH, etc)
  const cryptoPattern = /\b(btc|eth|bitcoin|ethereum|crypto|cryptocurrency)\b/gi;
  const cryptoMatches = title.match(cryptoPattern);
  if (cryptoMatches) {
    cryptoMatches.forEach(crypto => {
      const normalized = ENTITY_MAPPINGS[crypto.toLowerCase()] || crypto.toLowerCase();
      entities.add(normalized);
    });
  }
  
  return Array.from(entities);
}

/**
 * Extract and parse dates from title
 * Handles: "October 31st", "Oct 31", "10/31", "10-31-2024", etc.
 */
function extractDates(title: string, expiryDate: Date): Date[] {
  const dates: Date[] = [];
  
  // Try various date formats
  
  // "October 31st", "October 31", "Oct 31"
  const monthDayPattern = new RegExp(
    `(${MONTH_NAMES.join('|')}|${MONTH_ABBR.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?`,
    'gi'
  );
  
  let match;
  while ((match = monthDayPattern.exec(title)) !== null) {
    const monthStr = match[1].toLowerCase();
    const day = parseInt(match[2]);
    
    // Find month index
    let monthIndex = MONTH_NAMES.indexOf(monthStr);
    if (monthIndex === -1) {
      monthIndex = MONTH_ABBR.indexOf(monthStr);
    }
    
    if (monthIndex !== -1) {
      // Use expiry year as reference
      const year = expiryDate.getFullYear();
      const date = new Date(year, monthIndex, day);
      dates.push(date);
    }
  }
  
  // "10/31/2024", "10/31"
  const slashPattern = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g;
  while ((match = slashPattern.exec(title)) !== null) {
    const month = parseInt(match[1]) - 1; // 0-indexed
    const day = parseInt(match[2]);
    const year = match[3] ? parseInt(match[3]) : expiryDate.getFullYear();
    dates.push(new Date(year, month, day));
  }
  
  // "2024-10-31"
  const isoPattern = /(\d{4})-(\d{2})-(\d{2})/g;
  while ((match = isoPattern.exec(title)) !== null) {
    const year = parseInt(match[1]);
    const month = parseInt(match[2]) - 1;
    const day = parseInt(match[3]);
    dates.push(new Date(year, month, day));
  }
  
  // If no dates found, use expiry date
  if (dates.length === 0) {
    dates.push(expiryDate);
  }
  
  return dates;
}

/**
 * Extract numbers and thresholds
 * Handles: "70°F", "$50,000", "4.5%", etc.
 */
function extractNumbers(title: string): number[] {
  const numbers: number[] = [];
  
  // Remove currency symbols and commas, then extract numbers
  const cleanTitle = title.replace(/[$,]/g, '');
  
  // Match numbers with optional decimal points
  const numberPattern = /\b(\d+(?:\.\d+)?)\s*(?:°|degrees|percent|%|k|m|b)?\b/gi;
  
  let match;
  while ((match = numberPattern.exec(cleanTitle)) !== null) {
    let num = parseFloat(match[1]);
    
    // Handle K, M, B suffixes
    const suffix = match[0].slice(-1).toLowerCase();
    if (suffix === 'k') num *= 1000;
    if (suffix === 'm') num *= 1000000;
    if (suffix === 'b') num *= 1000000000;
    
    numbers.push(num);
  }
  
  return numbers;
}

/**
 * Extract what's being measured
 */
function extractMetric(title: string): string | undefined {
  const metrics = [
    'price', 'temperature', 'score', 'points', 'goals', 'approval',
    'rating', 'index', 'rate', 'unemployment', 'inflation', 'gdp',
    'stock', 'close', 'open', 'volume', 'attendance'
  ];
  
  for (const metric of metrics) {
    if (title.includes(metric)) {
      return metric;
    }
  }
  
  return undefined;
}

/**
 * Extract directional comparison
 */
function extractDirection(title: string): 'above' | 'below' | 'between' | 'equals' | 'wins' | 'loses' | undefined {
  if (/(above|over|more than|greater than|exceed)/i.test(title)) return 'above';
  if (/(below|under|less than|lower than)/i.test(title)) return 'below';
  if (/between/i.test(title)) return 'between';
  if (/(equal|exactly)/i.test(title)) return 'equals';
  if (/(win|wins|beat|defeats|victory)/i.test(title)) return 'wins';
  if (/(lose|loses|lost|defeat)/i.test(title)) return 'loses';
  
  return undefined;
}

/**
 * Basic title normalization (fallback)
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Alias for backwards compatibility
export const normalizeForMatching = normalizeTitle;

/**
 * Calculate similarity score between two parsed markets (0-1)
 */
export function calculateMarketSimilarity(market1: ParsedMarket, market2: ParsedMarket): number {
  let score = 0;
  let weights = 0;
  
  // Entity overlap (highest weight)
  if (market1.entities.length > 0 && market2.entities.length > 0) {
    const entities1 = new Set(market1.entities);
    const entities2 = new Set(market2.entities);
    const intersection = new Set([...entities1].filter(e => entities2.has(e)));
    const union = new Set([...entities1, ...entities2]);
    
    const entitySimilarity = intersection.size / union.size;
    score += entitySimilarity * 0.4; // 40% weight
    weights += 0.4;
  }
  
  // Date overlap
  if (market1.dates.length > 0 && market2.dates.length > 0) {
    const dateMatch = market1.dates.some(d1 => 
      market2.dates.some(d2 => 
        Math.abs(d1.getTime() - d2.getTime()) < 86400000 // Within 1 day
      )
    );
    score += (dateMatch ? 1 : 0) * 0.25; // 25% weight
    weights += 0.25;
  }
  
  // Number overlap (thresholds)
  if (market1.numbers.length > 0 && market2.numbers.length > 0) {
    const numberMatch = market1.numbers.some(n1 =>
      market2.numbers.some(n2 =>
        Math.abs(n1 - n2) < (n1 * 0.01) // Within 1%
      )
    );
    score += (numberMatch ? 1 : 0) * 0.15; // 15% weight
    weights += 0.15;
  }
  
  // Metric match
  if (market1.metric && market2.metric) {
    const metricMatch = market1.metric === market2.metric;
    score += (metricMatch ? 1 : 0) * 0.1; // 10% weight
    weights += 0.1;
  }
  
  // Direction compatibility (if directions oppose, might still be same market)
  if (market1.direction && market2.direction) {
    const sameDirection = market1.direction === market2.direction;
    const oppositeDirection = 
      (market1.direction === 'above' && market2.direction === 'below') ||
      (market1.direction === 'below' && market2.direction === 'above') ||
      (market1.direction === 'wins' && market2.direction === 'loses') ||
      (market1.direction === 'loses' && market2.direction === 'wins');
    
    // Same direction is good, opposite is also good (just need to flip sides)
    score += (sameDirection || oppositeDirection ? 1 : 0) * 0.1; // 10% weight
    weights += 0.1;
  }
  
  // Normalize score
  return weights > 0 ? score / weights : 0;
}

/**
 * Check if markets have opposing directions (need to flip YES/NO)
 */
export function marketsHaveOpposingDirections(market1: ParsedMarket, market2: ParsedMarket): boolean {
  if (!market1.direction || !market2.direction) return false;
  
  return (
    (market1.direction === 'above' && market2.direction === 'below') ||
    (market1.direction === 'below' && market2.direction === 'above') ||
    (market1.direction === 'wins' && market2.direction === 'loses') ||
    (market1.direction === 'loses' && market2.direction === 'wins')
  );
}

/**
 * Find matching markets across platforms
 * Returns pairs with similarity scores
 */
export function findMatchingMarkets(
  markets1: Market[],
  markets2: Market[],
  minSimilarity: number = 0.7
): Array<{
  market1: Market;
  market2: Market;
  similarity: number;
  flipSides: boolean; // If true, need to bet opposite sides
}> {
  const matches: Array<{
    market1: Market;
    market2: Market;
    similarity: number;
    flipSides: boolean;
  }> = [];
  
  // Parse all markets
  const parsed1 = markets1.map(parseMarket);
  const parsed2 = markets2.map(parseMarket);
  
  // Compare each market from platform 1 with each from platform 2
  for (const p1 of parsed1) {
    for (const p2 of parsed2) {
      // Skip if same platform
      if (p1.original.platform === p2.original.platform) continue;
      
      const similarity = calculateMarketSimilarity(p1, p2);
      
      if (similarity >= minSimilarity) {
        const flipSides = marketsHaveOpposingDirections(p1, p2);
        
        matches.push({
          market1: p1.original,
          market2: p2.original,
          similarity,
          flipSides,
        });
      }
    }
  }
  
  // Sort by similarity (highest first)
  return matches.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Fuzzy string matching using Levenshtein distance
 * Useful as a fallback for complex titles
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = [];
  
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,      // deletion
          dp[i][j - 1] + 1,      // insertion
          dp[i - 1][j - 1] + 1   // substitution
        );
      }
    }
  }
  
  return dp[m][n];
}

/**
 * Calculate fuzzy similarity (0-1) using Levenshtein distance
 */
export function fuzzyStringSimilarity(str1: string, str2: string): number {
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  const maxLength = Math.max(str1.length, str2.length);
  return 1 - (distance / maxLength);
}

/**
 * Add custom entity mappings (can be called to expand knowledge base)
 */
export function addEntityMapping(variations: string[], canonical: string): void {
  for (const variation of variations) {
    ENTITY_MAPPINGS[variation.toLowerCase()] = canonical.toLowerCase();
  }
}

/**
 * Get match explanation (for debugging/logging)
 */
export function explainMatch(market1: ParsedMarket, market2: ParsedMarket): string {
  const lines: string[] = [];
  
  lines.push(`Market 1: ${market1.original.title}`);
  lines.push(`Market 2: ${market2.original.title}`);
  lines.push('');
  
  const entities1 = new Set(market1.entities);
  const entities2 = new Set(market2.entities);
  const sharedEntities = [...entities1].filter(e => entities2.has(e));
  
  if (sharedEntities.length > 0) {
    lines.push(`Shared entities: ${sharedEntities.join(', ')}`);
  }
  
  if (market1.dates.length > 0 && market2.dates.length > 0) {
    lines.push(`Dates: ${market1.dates[0].toDateString()} vs ${market2.dates[0].toDateString()}`);
  }
  
  if (market1.numbers.length > 0 && market2.numbers.length > 0) {
    lines.push(`Numbers: ${market1.numbers.join(', ')} vs ${market2.numbers.join(', ')}`);
  }
  
  if (market1.metric && market2.metric) {
    lines.push(`Metrics: ${market1.metric} vs ${market2.metric}`);
  }
  
  if (market1.direction && market2.direction) {
    lines.push(`Directions: ${market1.direction} vs ${market2.direction}`);
  }
  
  const similarity = calculateMarketSimilarity(market1, market2);
  lines.push(`\nSimilarity score: ${(similarity * 100).toFixed(1)}%`);
  
  return lines.join('\n');
}


