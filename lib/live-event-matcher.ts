/**
 * Live Event Matcher
 *
 * Deterministic rule-based matcher for cross-platform sports events.
 * NO AI/ML - pure heuristic matching using:
 * - Sport / league
 * - Team names (normalized, alias-mapped)
 * - Start times
 *
 * Produces MatchedEventGroups that represent the same real-world event
 * across multiple betting platforms.
 */

import {
  VendorEvent,
  MatchedEventGroup,
  LiveEventPlatform,
  LiveEventRegistrySnapshot,
  Sport,
  VendorEventStatus,
  buildLiveEventMatcherConfig,
  LiveEventMatcherConfig,
} from '@/types/live-events';
import { getSnapshot, getCurrentEvents } from './live-event-registry';

// ============================================================================
// Team Alias Map
// ============================================================================

/**
 * Map of team name aliases to canonical names
 * Add entries as needed for common variations
 */
type TeamAliasValue =
  | string
  | {
      default: string;
      perSport?: Partial<Record<Sport, string>>;
    };

const TEAM_ALIAS_MAP: Record<string, TeamAliasValue> = {
  // NBA
  'ny knicks': 'new york knicks',
  'knicks': 'new york knicks',
  'la lakers': 'los angeles lakers',
  'lakers': 'los angeles lakers',
  'la clippers': 'los angeles clippers',
  'clippers': 'los angeles clippers',
  'gs warriors': 'golden state warriors',
  'warriors': 'golden state warriors',
  'gsw': 'golden state warriors',
  'philly': 'philadelphia 76ers',
  '76ers': 'philadelphia 76ers',
  'sixers': 'philadelphia 76ers',
  'okc': 'oklahoma city thunder',
  'thunder': 'oklahoma city thunder',
  'celtics': 'boston celtics',
  'heat': 'miami heat',
  'bucks': 'milwaukee bucks',
  'mavs': 'dallas mavericks',
  'mavericks': 'dallas mavericks',
  'suns': 'phoenix suns',
  'nuggets': 'denver nuggets',
  'cavs': 'cleveland cavaliers',
  'cavaliers': 'cleveland cavaliers',
  'nets': 'brooklyn nets',
  'blazers': 'portland trail blazers',
  'trailblazers': 'portland trail blazers',
  'wolves': {
    default: 'minnesota timberwolves',
    perSport: {
      EPL: 'wolverhampton wanderers',
    },
  },
  'timberwolves': 'minnesota timberwolves',
  'pacers': 'indiana pacers',
  'hawks': {
    default: 'atlanta hawks',
    perSport: {
      NHL: 'chicago blackhawks',
    },
  },
  'wizards': 'washington wizards',
  'bulls': 'chicago bulls',
  'raptors': 'toronto raptors',
  'magic': 'orlando magic',
  'pistons': 'detroit pistons',
  'hornets': 'charlotte hornets',
  'spurs': {
    default: 'san antonio spurs',
    perSport: {
      EPL: 'tottenham hotspur',
    },
  },
  'jazz': 'utah jazz',
  'rockets': 'houston rockets',
  'grizzlies': 'memphis grizzlies',
  'pelicans': 'new orleans pelicans',
  'kings': 'sacramento kings',
  
  // NFL
  'niners': 'san francisco 49ers',
  '49ers': 'san francisco 49ers',
  'sf 49ers': 'san francisco 49ers',
  'pats': 'new england patriots',
  'patriots': 'new england patriots',
  'boys': 'dallas cowboys',
  'cowboys': 'dallas cowboys',
  'pack': 'green bay packers',
  'packers': 'green bay packers',
  'chiefs': 'kansas city chiefs',
  'kc chiefs': 'kansas city chiefs',
  'ravens': 'baltimore ravens',
  'steelers': 'pittsburgh steelers',
  'bills': 'buffalo bills',
  'dolphins': 'miami dolphins',
  'jets': 'new york jets',
  'ny jets': 'new york jets',
  'giants': 'new york giants',
  'ny giants': 'new york giants',
  'eagles': 'philadelphia eagles',
  'philly eagles': 'philadelphia eagles',
  'commanders': 'washington commanders',
  'redskins': 'washington commanders',
  'bears': 'chicago bears',
  'lions': 'detroit lions',
  'vikings': 'minnesota vikings',
  'saints': 'new orleans saints',
  'bucs': 'tampa bay buccaneers',
  'buccaneers': 'tampa bay buccaneers',
  'falcons': 'atlanta falcons',
  'panthers': 'carolina panthers',
  'seahawks': 'seattle seahawks',
  'rams': 'los angeles rams',
  'la rams': 'los angeles rams',
  'cards': 'arizona cardinals',
  'cardinals': 'arizona cardinals',
  'chargers': 'los angeles chargers',
  'la chargers': 'los angeles chargers',
  'raiders': 'las vegas raiders',
  'lv raiders': 'las vegas raiders',
  'broncos': 'denver broncos',
  'colts': 'indianapolis colts',
  'texans': 'houston texans',
  'titans': 'tennessee titans',
  'jags': 'jacksonville jaguars',
  'jaguars': 'jacksonville jaguars',
  'bengals': 'cincinnati bengals',
  'browns': 'cleveland browns',
  
  // NHL
  'leafs': 'toronto maple leafs',
  'maple leafs': 'toronto maple leafs',
  'habs': 'montreal canadiens',
  'canadiens': 'montreal canadiens',
  'bruins': 'boston bruins',
  'rangers': 'new york rangers',
  'ny rangers': 'new york rangers',
  'isles': 'new york islanders',
  'islanders': 'new york islanders',
  'ny islanders': 'new york islanders',
  'caps': 'washington capitals',
  'capitals': 'washington capitals',
  'pens': 'pittsburgh penguins',
  'penguins': 'pittsburgh penguins',
  'flyers': 'philadelphia flyers',
  'devils': 'new jersey devils',
  'nj devils': 'new jersey devils',
  'wings': 'detroit red wings',
  'red wings': 'detroit red wings',
  'blackhawks': 'chicago blackhawks',
  'wild': 'minnesota wild',
  'blues': {
    default: 'st louis blues',
    perSport: {
      EPL: 'chelsea fc',
    },
  },
  'avs': 'colorado avalanche',
  'avalanche': 'colorado avalanche',
  'oilers': 'edmonton oilers',
  'flames': 'calgary flames',
  'canucks': 'vancouver canucks',
  'sharks': 'san jose sharks',
  'ducks': 'anaheim ducks',
  'golden knights': 'vegas golden knights',
  'vgk': 'vegas golden knights',
  'kraken': 'seattle kraken',
  'canes': 'carolina hurricanes',
  'hurricanes': 'carolina hurricanes',
  'bolts': 'tampa bay lightning',
  'lightning': 'tampa bay lightning',
  
  // MLB
  'yanks': 'new york yankees',
  'yankees': 'new york yankees',
  'mets': 'new york mets',
  'ny mets': 'new york mets',
  'red sox': 'boston red sox',
  'sox': 'boston red sox',
  'white sox': 'chicago white sox',
  'cubs': 'chicago cubs',
  'dodgers': 'los angeles dodgers',
  'la dodgers': 'los angeles dodgers',
  'angels': 'los angeles angels',
  'la angels': 'los angeles angels',
  'padres': 'san diego padres',
  'mariners': 'seattle mariners',
  'astros': 'houston astros',
  'phillies': 'philadelphia phillies',
  'braves': 'atlanta braves',
  'marlins': 'miami marlins',
  'nationals': 'washington nationals',
  'nats': 'washington nationals',
  'orioles': 'baltimore orioles',
  'os': 'baltimore orioles',
  'blue jays': 'toronto blue jays',
  'jays': 'toronto blue jays',
  'rays': 'tampa bay rays',
  'twins': 'minnesota twins',
  'royals': 'kansas city royals',
  'guardians': 'cleveland guardians',
  'indians': 'cleveland guardians',
  'reds': {
    default: 'cincinnati reds',
    perSport: {
      EPL: 'liverpool fc',
    },
  },
  'brewers': 'milwaukee brewers',
  'pirates': 'pittsburgh pirates',
  'dbacks': 'arizona diamondbacks',
  'diamondbacks': 'arizona diamondbacks',
  'rockies': 'colorado rockies',
  'as': 'oakland athletics',
  'athletics': 'oakland athletics',
  
  // Soccer - EPL
  'man utd': 'manchester united',
  'man u': 'manchester united',
  'mufc': 'manchester united',
  'united': 'manchester united',
  'man city': 'manchester city',
  'city': 'manchester city',
  'mcfc': 'manchester city',
  'arsenal': 'arsenal fc',
  'gunners': 'arsenal fc',
  'chelsea': 'chelsea fc',
  'cfc': 'chelsea fc',
  'liverpool': 'liverpool fc',
  'lfc': 'liverpool fc',
  'tottenham': 'tottenham hotspur',
  'thfc': 'tottenham hotspur',
  'villa': 'aston villa',
  'avfc': 'aston villa',
  'newcastle': 'newcastle united',
  'nufc': 'newcastle united',
  'toon': 'newcastle united',
  'west ham': 'west ham united',
  'hammers': 'west ham united',
  'whufc': 'west ham united',
  'everton': 'everton fc',
  'toffees': 'everton fc',
  'efc': 'everton fc',
  'brighton': 'brighton & hove albion',
  'seagulls': 'brighton & hove albion',
  'brentford': 'brentford fc',
  'bees': 'brentford fc',
  'forest': 'nottingham forest',
  'nffc': 'nottingham forest',
  'fulham': 'fulham fc',
  'cottagers': 'fulham fc',
  'palace': 'crystal palace',
  'cpfc': 'crystal palace',
  'bournemouth': 'afc bournemouth',
  'cherries': 'afc bournemouth',
};

// ============================================================================
// Text Normalization
// ============================================================================

/**
 * Normalize text for matching
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')    // Remove punctuation
    .replace(/\s+/g, ' ')         // Collapse whitespace
    .trim();
}

/**
 * Resolve alias entry to canonical name
 */
function resolveAliasValue(value: TeamAliasValue, sport?: Sport): string {
  if (typeof value === 'string') {
    return value;
  }

  if (sport && value.perSport?.[sport]) {
    return value.perSport[sport]!;
  }

  return value.default;
}

/**
 * Normalize a team name using the alias map
 */
export function normalizeTeamName(name: string, sport?: Sport): string {
  const normalized = normalizeText(name);
  const alias = TEAM_ALIAS_MAP[normalized];

  if (!alias) {
    return normalized;
  }

  return resolveAliasValue(alias, sport);
}

/**
 * Parse teams from a title string
 * Handles patterns like:
 * - "Team A vs Team B"
 * - "Team A @ Team B"
 * - "Team A - Team B"
 * - "Team A v Team B"
 */
export function parseTeamsFromTitle(rawTitle: string, sport?: Sport): {
  home?: string;
  away?: string;
  teams: string[];
} {
  const title = normalizeText(rawTitle);
  
  // Try various separators
  const separators = [' vs ', ' v ', ' @ ', ' at ', ' - ', ' versus '];
  
  for (const sep of separators) {
    const parts = title.split(sep);
    if (parts.length === 2) {
      const team1 = normalizeTeamName(parts[0].trim(), sport);
      const team2 = normalizeTeamName(parts[1].trim(), sport);
      
      // For @ or "at", team2 is home
      if (sep === ' @ ' || sep === ' at ') {
        return { home: team2, away: team1, teams: [team1, team2] };
      }
      
      // Default: team1 is home
      return { home: team1, away: team2, teams: [team1, team2] };
    }
  }
  
  // Try to extract any team names we recognize
  const foundTeams: string[] = [];
  const words = title.split(' ');
  
  for (let i = 0; i < words.length; i++) {
    // Try single word
    const singleWord = words[i];
    if (TEAM_ALIAS_MAP[singleWord]) {
      foundTeams.push(resolveAliasValue(TEAM_ALIAS_MAP[singleWord]!, sport));
      continue;
    }
    
    // Try two-word combinations
    if (i < words.length - 1) {
      const twoWords = `${words[i]} ${words[i + 1]}`;
      if (TEAM_ALIAS_MAP[twoWords]) {
        foundTeams.push(resolveAliasValue(TEAM_ALIAS_MAP[twoWords]!, sport));
        continue;
      }
    }
    
    // Try three-word combinations
    if (i < words.length - 2) {
      const threeWords = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      if (TEAM_ALIAS_MAP[threeWords]) {
        foundTeams.push(resolveAliasValue(TEAM_ALIAS_MAP[threeWords]!, sport));
      }
    }
  }
  
  // Deduplicate
  const uniqueTeams = [...new Set(foundTeams)];
  
  if (uniqueTeams.length >= 2) {
    return { home: uniqueTeams[0], away: uniqueTeams[1], teams: uniqueTeams };
  } else if (uniqueTeams.length === 1) {
    return { teams: uniqueTeams };
  }
  
  return { teams: [] };
}

/**
 * Calculate similarity between two strings (Jaccard index on words)
 */
function stringSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeText(a).split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normalizeText(b).split(' ').filter(w => w.length > 2));
  
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  
  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

/**
 * Check if two team names match
 */
function teamsMatch(team1: string, team2: string, minSimilarity: number, sport?: Sport): boolean {
  const norm1 = normalizeTeamName(team1, sport);
  const norm2 = normalizeTeamName(team2, sport);
  
  // Exact match after normalization
  if (norm1 === norm2) return true;
  
  // Similarity check
  return stringSimilarity(norm1, norm2) >= minSimilarity;
}

// ============================================================================
// Matching Logic
// ============================================================================

/**
 * Check if two events potentially represent the same real-world event
 */
function eventsMatch(
  event1: VendorEvent,
  event2: VendorEvent,
  config: LiveEventMatcherConfig
): { match: boolean; quality: number } {
  // Must be same sport
  if (event1.sport !== event2.sport) {
    return { match: false, quality: 0 };
  }
  
  // Must not be from the same platform
  if (event1.platform === event2.platform) {
    return { match: false, quality: 0 };
  }
  
  // Check time tolerance
  if (event1.startTime && event2.startTime) {
    const timeDiff = Math.abs(event1.startTime - event2.startTime);
    if (timeDiff > config.timeTolerance) {
      return { match: false, quality: 0 };
    }
  }
  
  // Check league if available
  let leagueMatch = true;
  if (event1.league && event2.league) {
    const league1 = normalizeText(event1.league);
    const league2 = normalizeText(event2.league);
    leagueMatch = league1 === league2 || 
                  stringSimilarity(league1, league2) > 0.6;
  }
  
  if (!leagueMatch) {
    return { match: false, quality: 0 };
  }
  
  // Check team matching
  const teams1 = event1.teams.map(team => normalizeTeamName(team, event1.sport));
  const teams2 = event2.teams.map(team => normalizeTeamName(team, event2.sport));
  
  if (teams1.length < 2 || teams2.length < 2) {
    // Not enough teams to match
    return { match: false, quality: 0 };
  }
  
  // Count matching teams
  let matchedTeams = 0;
  const matchedFrom2 = new Set<number>();
  
  for (const t1 of teams1) {
    for (let i = 0; i < teams2.length; i++) {
      if (matchedFrom2.has(i)) continue;
      if (teamsMatch(t1, teams2[i], config.minTeamSimilarity, event1.sport)) {
        matchedTeams++;
        matchedFrom2.add(i);
        break;
      }
    }
  }
  
  // Need at least 2 matching teams for a sports event
  if (matchedTeams < 2) {
    return { match: false, quality: 0 };
  }
  
  // Calculate quality score
  let quality = 0.5; // Base for 2-team match
  
  // Bonus for exact team matches
  quality += matchedTeams * 0.15;
  
  // Bonus for league match
  if (leagueMatch && event1.league && event2.league) {
    quality += 0.1;
  }
  
  // Bonus for close start times
  if (event1.startTime && event2.startTime) {
    const timeDiff = Math.abs(event1.startTime - event2.startTime);
    if (timeDiff < 5 * 60 * 1000) { // Within 5 minutes
      quality += 0.15;
    } else if (timeDiff < 15 * 60 * 1000) { // Within 15 minutes
      quality += 0.1;
    }
  }
  
  // Bonus for both being live
  if (event1.status === 'LIVE' && event2.status === 'LIVE') {
    quality += 0.1;
  }
  
  return { match: true, quality: Math.min(quality, 1.0) };
}

/**
 * Generate a canonical event key for a matched group
 */
function generateEventKey(events: VendorEvent[]): string {
  // Collect all teams and normalize
  const allTeams = new Set<string>();
  for (const e of events) {
    e.teams.forEach(t => allTeams.add(normalizeTeamName(t, e.sport)));
  }
  
  // Sort for consistency
  const sortedTeams = [...allTeams].sort();
  
  // Get canonical sport
  const sport = events[0].sport;
  
  // Get date from start time (if available)
  let dateStr = 'unknown';
  const startTime = events.find(e => e.startTime)?.startTime;
  if (startTime) {
    const date = new Date(startTime);
    dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  }
  
  // Create key
  return `${sport}:${sortedTeams.slice(0, 2).join('-')}:${dateStr}`;
}

// ============================================================================
// Matched Groups Storage
// ============================================================================

/** In-memory store of matched groups */
const matchedGroups = new Map<string, MatchedEventGroup>();

/** Last update timestamp */
let lastMatcherRun = 0;

// ============================================================================
// Public API
// ============================================================================

/**
 * Update matches based on current registry state
 */
export function updateMatches(snapshot?: LiveEventRegistrySnapshot): void {
  const config = buildLiveEventMatcherConfig();
  const registrySnapshot = snapshot || getSnapshot();
  const now = Date.now();
  
  // Get live and near-live events
  const activeEvents = registrySnapshot.events.filter(e => {
    if (e.status === 'LIVE') return true;
    if (e.status === 'PRE' && e.startTime) {
      const timeToStart = e.startTime - now;
      return timeToStart <= config.preGameWindow && timeToStart >= 0;
    }
    return false;
  });
  
  // Group by platform for efficiency
  const byPlatform: Record<LiveEventPlatform, VendorEvent[]> = {
    SXBET: [],
    POLYMARKET: [],
    KALSHI: [],
  };
  
  for (const event of activeEvents) {
    byPlatform[event.platform].push(event);
  }
  
  // Find new matches
  const newMatches = new Map<string, VendorEvent[]>();
  const platforms: LiveEventPlatform[] = ['SXBET', 'POLYMARKET', 'KALSHI'];
  
  // Compare events across platforms
  for (let i = 0; i < platforms.length; i++) {
    for (let j = i + 1; j < platforms.length; j++) {
      const platform1 = platforms[i];
      const platform2 = platforms[j];
      
      for (const event1 of byPlatform[platform1]) {
        for (const event2 of byPlatform[platform2]) {
          const { match, quality } = eventsMatch(event1, event2, config);
          
          if (match) {
            const key = generateEventKey([event1, event2]);
            
            if (!newMatches.has(key)) {
              newMatches.set(key, []);
            }
            
            const events = newMatches.get(key)!;
            
            // Add if not already present
            if (!events.some(e => 
              e.platform === event1.platform && 
              e.vendorMarketId === event1.vendorMarketId
            )) {
              events.push(event1);
            }
            
            if (!events.some(e => 
              e.platform === event2.platform && 
              e.vendorMarketId === event2.vendorMarketId
            )) {
              events.push(event2);
            }
          }
        }
      }
    }
  }
  
  // Update matched groups
  for (const [key, events] of newMatches) {
    const existingGroup = matchedGroups.get(key);
    
    // Get canonical values
    const allTeams = new Set<string>();
    let canonicalStartTime: number | undefined;
    let canonicalSport: Sport = events[0].sport;
    let canonicalLeague: string | undefined;
    let status: VendorEventStatus = 'PRE';
    
    for (const e of events) {
      e.teams.forEach(t => allTeams.add(normalizeTeamName(t, e.sport)));
      if (!canonicalStartTime && e.startTime) {
        canonicalStartTime = e.startTime;
      }
      if (!canonicalLeague && e.league) {
        canonicalLeague = e.league;
      }
      if (e.status === 'LIVE') {
        status = 'LIVE';
      }
    }
    
    const sortedTeams = [...allTeams].sort();
    
    // Count platforms
    const platformSet = new Set(events.map(e => e.platform));
    
    // Build vendor map
    const vendors: MatchedEventGroup['vendors'] = {};
    for (const e of events) {
      if (!vendors[e.platform]) {
        vendors[e.platform] = [];
      }
      vendors[e.platform]!.push(e);
    }
    
    // Calculate match quality
    let quality = 0.5 + (platformSet.size - 2) * 0.2; // Bonus for 3+ platforms
    if (events.every(e => e.status === 'LIVE')) quality += 0.15;
    if (canonicalLeague) quality += 0.1;
    quality = Math.min(quality, 1.0);
    
    const group: MatchedEventGroup = {
      eventKey: key,
      sport: canonicalSport,
      league: canonicalLeague,
      homeTeam: sortedTeams[0],
      awayTeam: sortedTeams[1],
      startTime: canonicalStartTime,
      status,
      vendors,
      platformCount: platformSet.size,
      totalEvents: events.length,
      lastMatchedAt: now,
      matchQuality: quality,
    };
    
    matchedGroups.set(key, group);
  }
  
  // Remove stale groups (no active events)
  for (const [key, group] of matchedGroups) {
    if (!newMatches.has(key)) {
      // Check if any events are still active
      let hasActive = false;
      for (const platform of platforms) {
        const vendorEvents = group.vendors[platform];
        if (vendorEvents) {
          for (const ve of vendorEvents) {
            const current = activeEvents.find(
              e => e.platform === platform && e.vendorMarketId === ve.vendorMarketId
            );
            if (current) {
              hasActive = true;
              break;
            }
          }
        }
        if (hasActive) break;
      }
      
      if (!hasActive && now - group.lastMatchedAt > config.postGameWindow) {
        matchedGroups.delete(key);
      }
    }
  }
  
  lastMatcherRun = now;
}

/**
 * Get matched event groups
 */
export function getMatchedEvents(filter?: {
  liveOnly?: boolean;
  minPlatforms?: number;
  sport?: Sport;
}): MatchedEventGroup[] {
  let groups = Array.from(matchedGroups.values());
  
  if (filter?.liveOnly) {
    groups = groups.filter(g => g.status === 'LIVE');
  }
  
  const minPlatforms = filter?.minPlatforms;
  if (typeof minPlatforms === 'number') {
    groups = groups.filter(g => g.platformCount >= minPlatforms);
  }
  
  if (filter?.sport) {
    groups = groups.filter(g => g.sport === filter.sport);
  }
  
  // Sort by quality descending
  groups.sort((a, b) => b.matchQuality - a.matchQuality);
  
  return groups;
}

/**
 * Get a specific matched group
 */
export function getMatchedGroup(eventKey: string): MatchedEventGroup | undefined {
  return matchedGroups.get(eventKey);
}

/**
 * Get matcher statistics
 */
export function getMatcherStats(): {
  totalGroups: number;
  liveGroups: number;
  preGroups: number;
  by3Platforms: number;
  by2Platforms: number;
  bySport: Record<string, number>;
  lastRunAt: number;
} {
  const groups = Array.from(matchedGroups.values());
  
  const bySport: Record<string, number> = {};
  for (const g of groups) {
    bySport[g.sport] = (bySport[g.sport] || 0) + 1;
  }
  
  return {
    totalGroups: groups.length,
    liveGroups: groups.filter(g => g.status === 'LIVE').length,
    preGroups: groups.filter(g => g.status === 'PRE').length,
    by3Platforms: groups.filter(g => g.platformCount >= 3).length,
    by2Platforms: groups.filter(g => g.platformCount === 2).length,
    bySport,
    lastRunAt: lastMatcherRun,
  };
}

/**
 * Clear all matched groups (for testing)
 */
export function clearMatchedGroups(): void {
  matchedGroups.clear();
  lastMatcherRun = 0;
}

/**
 * Log matcher state
 */
export function logMatcherState(): void {
  const stats = getMatcherStats();
  console.log('[LiveEventMatcher] Current state:');
  console.log(`  Total matched groups: ${stats.totalGroups}`);
  console.log(`  Live: ${stats.liveGroups}, Pre: ${stats.preGroups}`);
  console.log(`  3+ platforms: ${stats.by3Platforms}, 2 platforms: ${stats.by2Platforms}`);
  console.log(`  By sport: ${JSON.stringify(stats.bySport)}`);
}

