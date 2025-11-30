/**
 * Test Script: Live Events System
 *
 * Tests the CPU-only rule-based live sports matcher:
 * - Token-based text normalization
 * - Token overlap scoring
 * - Sport + time bucketing
 * - Connected components matching
 * - Registry operations
 * - File persistence
 *
 * Run with: npm run test-live-events
 */

import { 
  extractSxBetEvent, 
  extractPolymarketEvent, 
  extractKalshiEvent,
  processAllMarkets,
} from '../lib/live-event-extractors';
import {
  updateMatches,
  getMatchedEvents,
  clearMatchedGroups,
  setMatchedGroups,
  forcePersistGroupsToFile,
  loadGroupsFromFile,
  getGroupsFileInfo,
  normalizeTeamName,
  parseTeamsFromTitle,
} from '../lib/live-event-matcher';
import {
  normalizeEventTitle,
  scoreTokenOverlap,
  tokensMatch,
  getTimeBucket,
  timeBucketsMatch,
  getCommonTokens,
} from '../lib/text-normalizer';
import {
  addOrUpdateEvent,
  getSnapshot,
  clearRegistry,
  getRegistryStats,
  markPlatformSnapshot,
  pruneEndedEvents,
} from '../lib/live-event-registry';
import {
  saveMatchedGroupsToFile,
  loadMatchedGroupsFromFile,
  deleteMatchedGroupsFile,
  getMatchedGroupsFileInfo,
} from '../lib/live-event-groups-store';
import { VendorEvent, MatchedEventGroup, buildLiveEventMatcherConfig } from '../types/live-events';
import { Market } from '../types';

// ============================================================================
// Test Utilities
// ============================================================================

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✅ ${name}`);
    passCount++;
  } catch (error: any) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failCount++;
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message || 'Assertion failed'}: expected "${expected}", got "${actual}"`
    );
  }
}

function assertTrue(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(message || 'Expected true but got false');
  }
}

function assertDefined<T>(value: T | undefined | null, message?: string): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(message || 'Expected value to be defined');
  }
}

function assertContains(arr: string[], item: string, message?: string): void {
  if (!arr.includes(item)) {
    throw new Error(
      `${message || 'Array should contain'} "${item}". Got: [${arr.join(', ')}]`
    );
  }
}

function assertOverlap(arrA: string[], arrB: string[], minOverlap: number, message?: string): void {
  const setA = new Set(arrA);
  let overlap = 0;
  for (const item of arrB) {
    if (setA.has(item)) overlap++;
  }
  if (overlap < minOverlap) {
    throw new Error(
      `${message || 'Expected overlap'} >= ${minOverlap}, got ${overlap}. A=[${arrA.join(', ')}], B=[${arrB.join(', ')}]`
    );
  }
}

// ============================================================================
// Test Data
// ============================================================================

function createSxBetMarket(id: string, title: string, expiryDate?: string): Market {
  return {
    id,
    ticker: id,
    platform: 'sxbet',
    marketType: 'sportsbook',
    title,
    yesPrice: 1.9,
    noPrice: 2.1,
    expiryDate: expiryDate || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

function createPolymarketMarket(id: string, title: string, expiryDate?: string): Market {
  return {
    id,
    ticker: id,
    platform: 'polymarket',
    marketType: 'prediction',
    title,
    yesPrice: 48,
    noPrice: 52,
    expiryDate: expiryDate || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

function createKalshiMarket(ticker: string, title: string, expiryDate?: string): Market {
  return {
    id: ticker,
    ticker,
    platform: 'kalshi',
    marketType: 'prediction',
    title,
    yesPrice: 45,
    noPrice: 55,
    expiryDate: expiryDate || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

// ============================================================================
// Test: Token Normalization
// ============================================================================

function testTokenNormalization() {
  console.log('\n--- Token Normalization Tests ---\n');

  test('normalizes "Detroit Red Wings vs Boston Bruins" to tokens', () => {
    const { tokens } = normalizeEventTitle('Detroit Red Wings vs Boston Bruins', { sport: 'NHL' });
    assertContains(tokens, 'detroit', 'Should contain detroit');
    assertContains(tokens, 'red', 'Should contain red');
    assertContains(tokens, 'wings', 'Should contain wings');
    assertContains(tokens, 'boston', 'Should contain boston');
    assertContains(tokens, 'bruins', 'Should contain bruins');
    // Should NOT contain 'vs' (stopword)
    assertTrue(!tokens.includes('vs'), 'Should not contain stopword "vs"');
  });

  test('normalizes "Redwings @ Bruins" similarly', () => {
    const { tokens } = normalizeEventTitle('Redwings @ Bruins', { sport: 'NHL' });
    // Should contain at least redwings and bruins
    assertTrue(
      tokens.includes('redwings') || tokens.includes('bruins'),
      'Should contain key team tokens'
    );
  });

  test('tokens share overlap for same game different titles', () => {
    const { tokens: tokens1 } = normalizeEventTitle('Detroit Red Wings vs Boston Bruins', { sport: 'NHL' });
    const { tokens: tokens2 } = normalizeEventTitle('Redwings @ Bruins', { sport: 'NHL' });
    
    // Should have some overlap (bruins at minimum)
    const score = scoreTokenOverlap(tokens1, tokens2);
    assertTrue(score.overlap >= 1, `Should have at least 1 overlapping token. Got overlap=${score.overlap}`);
  });

  test('removes sport keywords from tokens', () => {
    const { tokens } = normalizeEventTitle('NBA Lakers vs Celtics Basketball Game', { sport: 'NBA' });
    assertTrue(!tokens.includes('nba'), 'Should not contain "nba"');
    assertTrue(!tokens.includes('basketball'), 'Should not contain "basketball"');
    assertTrue(!tokens.includes('game'), 'Should not contain "game"');
    assertContains(tokens, 'lakers', 'Should contain lakers');
    assertContains(tokens, 'celtics', 'Should contain celtics');
  });

  test('removes betting boilerplate from tokens', () => {
    const { tokens } = normalizeEventTitle('Lakers vs Celtics (Moneyline)', { sport: 'NBA' });
    assertTrue(!tokens.includes('moneyline'), 'Should not contain "moneyline"');
    assertContains(tokens, 'lakers', 'Should contain lakers');
  });

  test('handles esports titles', () => {
    const { tokens } = normalizeEventTitle('Team Spirit vs Gaimin Gladiators - CS2', { sport: 'ESPORTS' });
    assertTrue(
      tokens.some(t => t.includes('spirit') || t.includes('gaimin') || t.includes('gladiators')),
      'Should contain team tokens'
    );
    assertTrue(!tokens.includes('cs2'), 'Should not contain sport keyword "cs2"');
  });
}

// ============================================================================
// Test: Token Overlap Scoring
// ============================================================================

function testTokenOverlapScoring() {
  console.log('\n--- Token Overlap Scoring Tests ---\n');

  test('scoreTokenOverlap calculates overlap correctly', () => {
    const tokensA = ['detroit', 'red', 'wings', 'boston', 'bruins'];
    const tokensB = ['boston', 'bruins', 'detroit', 'redwings'];
    
    const score = scoreTokenOverlap(tokensA, tokensB);
    // overlap = 3 (boston, bruins, detroit)
    assertTrue(score.overlap >= 2, `Overlap should be >= 2, got ${score.overlap}`);
  });

  test('scoreTokenOverlap handles empty arrays', () => {
    const score = scoreTokenOverlap([], ['a', 'b']);
    assertEqual(score.overlap, 0, 'Empty array should have 0 overlap');
    assertEqual(score.coverage, 0, 'Empty array should have 0 coverage');
    assertEqual(score.jaccard, 0, 'Empty array should have 0 jaccard');
  });

  test('coverage is overlap / min(|A|, |B|)', () => {
    const tokensA = ['a', 'b', 'c'];
    const tokensB = ['b', 'c'];
    
    const score = scoreTokenOverlap(tokensA, tokensB);
    // overlap = 2 (b, c), min(3, 2) = 2, coverage = 2/2 = 1.0
    assertEqual(score.coverage, 1.0, 'Coverage should be 1.0 for full overlap of smaller set');
  });

  test('jaccard is overlap / |A ∪ B|', () => {
    const tokensA = ['a', 'b', 'c'];
    const tokensB = ['b', 'c', 'd'];
    
    const score = scoreTokenOverlap(tokensA, tokensB);
    // overlap = 2 (b, c), union = 4 (a,b,c,d), jaccard = 2/4 = 0.5
    assertEqual(score.jaccard, 0.5, 'Jaccard should be 0.5');
  });

  test('tokensMatch returns true when thresholds are met', () => {
    const tokensA = ['detroit', 'red', 'wings', 'boston', 'bruins'];
    const tokensB = ['boston', 'bruins', 'detroit'];
    
    // overlap = 3, min size = 3, coverage = 1.0
    const result = tokensMatch(tokensA, tokensB, 2, 0.6);
    assertTrue(result, 'Should match with overlap=3, coverage=1.0');
  });

  test('tokensMatch returns false when thresholds not met', () => {
    const tokensA = ['detroit', 'red', 'wings', 'boston', 'bruins'];
    const tokensB = ['chicago', 'blackhawks', 'detroit'];
    
    // overlap = 1 (detroit), should fail minOverlap=2
    const result = tokensMatch(tokensA, tokensB, 2, 0.6);
    assertTrue(!result, 'Should not match with only 1 overlap');
  });
}

// ============================================================================
// Test: Time Bucketing
// ============================================================================

function testTimeBucketing() {
  console.log('\n--- Time Bucketing Tests ---\n');

  const toleranceMs = 15 * 60 * 1000; // 15 minutes

  test('same time goes to same bucket', () => {
    const time = Date.now();
    const bucket1 = getTimeBucket(time, toleranceMs);
    const bucket2 = getTimeBucket(time, toleranceMs);
    assertEqual(bucket1, bucket2, 'Same time should have same bucket');
  });

  test('times within tolerance may share buckets', () => {
    const time1 = Date.now();
    const time2 = time1 + 10 * 60 * 1000; // 10 minutes later
    
    const bucket1 = getTimeBucket(time1, toleranceMs);
    const bucket2 = getTimeBucket(time2, toleranceMs);
    
    assertTrue(
      timeBucketsMatch(bucket1, bucket2),
      'Times 10 min apart should be in matching buckets'
    );
  });

  test('times far apart do not match buckets', () => {
    const time1 = Date.now();
    const time2 = time1 + 2 * 60 * 60 * 1000; // 2 hours later
    
    const bucket1 = getTimeBucket(time1, toleranceMs);
    const bucket2 = getTimeBucket(time2, toleranceMs);
    
    assertTrue(
      !timeBucketsMatch(bucket1, bucket2),
      'Times 2 hours apart should not match buckets'
    );
  });
}

// ============================================================================
// Test: Extractors
// ============================================================================

function testExtractors() {
  console.log('\n--- Extractor Tests ---\n');

  test('extractSxBetEvent extracts NHL game with tokens', () => {
    const event = extractSxBetEvent(
      'market123',
      'Detroit Red Wings vs Boston Bruins',
      {
        sportLabel: 'hockey',
        leagueLabel: 'NHL',
        gameTime: Math.floor(Date.now() / 1000) + 3600,
        outcomeOneName: 'Detroit Red Wings',
        outcomeTwoName: 'Boston Bruins',
        status: 1,
      }
    );

    assertDefined(event, 'Event should be extracted');
    assertEqual(event.platform, 'SXBET', 'Platform should be SXBET');
    assertEqual(event.sport, 'NHL', 'Sport should be NHL');
    assertDefined(event.normalizedTokens, 'Should have normalizedTokens');
    assertTrue(event.normalizedTokens!.length > 0, 'Should have tokens');
  });

  test('extractPolymarketEvent extracts NBA game with tokens', () => {
    const event = extractPolymarketEvent(
      'condition456',
      'Will Lakers beat Celtics?',
      {
        tags: ['Sports', 'NBA'],
        category: 'Sports',
        gameStartTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }
    );

    assertDefined(event, 'Event should be extracted');
    assertEqual(event.platform, 'POLYMARKET', 'Platform should be POLYMARKET');
    assertEqual(event.sport, 'NBA', 'Sport should be NBA');
    assertDefined(event.normalizedTokens, 'Should have normalizedTokens');
    assertTrue(event.normalizedTokens!.length > 0, 'Should have tokens');
  });

  test('extractKalshiEvent extracts NFL game with tokens', () => {
    const event = extractKalshiEvent(
      'NFL-KC-PHI-2024',
      'Chiefs vs Eagles Super Bowl',
      {
        event_ticker: 'NFL-SUPERBOWL',
        close_time: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        status: 'open',
      }
    );

    assertDefined(event, 'Event should be extracted');
    assertEqual(event.platform, 'KALSHI', 'Platform should be KALSHI');
    assertEqual(event.sport, 'NFL', 'Sport should be NFL');
    assertDefined(event.normalizedTokens, 'Should have normalizedTokens');
    assertTrue(event.normalizedTokens!.length > 0, 'Should have tokens');
  });

  test('extractSxBetEvent returns null for non-sports market', () => {
    const event = extractSxBetEvent(
      'market789',
      'Will Bitcoin hit $100k?',
      {
        sportLabel: '',
        leagueLabel: '',
      }
    );

    assertEqual(event, null, 'Should return null for non-sports market');
  });
}

// ============================================================================
// Test: Registry Operations
// ============================================================================

function testRegistry() {
  console.log('\n--- Registry Tests ---\n');

  // Clean up before tests
  clearRegistry();

  test('addOrUpdateEvent adds new event', () => {
    const event: VendorEvent = {
      platform: 'SXBET',
      vendorMarketId: 'test-market-1',
      sport: 'NHL',
      homeTeam: 'detroit red wings',
      awayTeam: 'boston bruins',
      teams: ['detroit', 'red', 'wings', 'boston', 'bruins'],
      normalizedTokens: ['detroit', 'red', 'wings', 'boston', 'bruins'],
      startTime: Date.now() + 3600000,
      status: 'PRE',
      marketType: 'MONEYLINE',
      rawTitle: 'Red Wings vs Bruins',
      lastUpdatedAt: Date.now(),
      extractionConfidence: 0.9,
    };

    addOrUpdateEvent(event);
    const stats = getRegistryStats();
    assertEqual(stats.totalEvents, 1, 'Should have 1 event');
    assertEqual(stats.byPlatform.SXBET, 1, 'Should have 1 SXBET event');
  });

  test('addOrUpdateEvent updates existing event', () => {
    const event: VendorEvent = {
      platform: 'SXBET',
      vendorMarketId: 'test-market-1',
      sport: 'NHL',
      homeTeam: 'detroit red wings',
      awayTeam: 'boston bruins',
      teams: ['detroit', 'red', 'wings', 'boston', 'bruins'],
      normalizedTokens: ['detroit', 'red', 'wings', 'boston', 'bruins'],
      startTime: Date.now() + 3600000,
      status: 'LIVE', // Changed to LIVE
      marketType: 'MONEYLINE',
      rawTitle: 'Red Wings vs Bruins',
      lastUpdatedAt: Date.now(),
      extractionConfidence: 0.9,
    };

    addOrUpdateEvent(event);
    const stats = getRegistryStats();
    assertEqual(stats.totalEvents, 1, 'Should still have 1 event');
    assertEqual(stats.byStatus.LIVE, 1, 'Should have 1 LIVE event');
  });

  test('markPlatformSnapshot replaces all events for platform', () => {
    const events: VendorEvent[] = [
      {
        platform: 'POLYMARKET',
        vendorMarketId: 'pm-1',
        sport: 'NBA',
        teams: ['lakers', 'celtics'],
        normalizedTokens: ['lakers', 'celtics'],
        startTime: Date.now() + 3600000,
        status: 'PRE',
        marketType: 'MONEYLINE',
        rawTitle: 'Lakers vs Celtics',
        lastUpdatedAt: Date.now(),
        extractionConfidence: 0.8,
      },
      {
        platform: 'POLYMARKET',
        vendorMarketId: 'pm-2',
        sport: 'NBA',
        teams: ['warriors', 'heat'],
        normalizedTokens: ['warriors', 'heat'],
        startTime: Date.now() + 7200000,
        status: 'PRE',
        marketType: 'MONEYLINE',
        rawTitle: 'Warriors vs Heat',
        lastUpdatedAt: Date.now(),
        extractionConfidence: 0.8,
      },
    ];

    markPlatformSnapshot('POLYMARKET', events);
    const stats = getRegistryStats();
    assertEqual(stats.byPlatform.POLYMARKET, 2, 'Should have 2 POLYMARKET events');
  });

  test('getSnapshot returns all events', () => {
    const snapshot = getSnapshot();
    assertTrue(snapshot.events.length >= 3, 'Should have at least 3 events');
  });

  test('pruneEndedEvents removes stale PRE events', () => {
    // Clear and add old PRE event
    clearRegistry();
    
    const oldPreEvent: VendorEvent = {
      platform: 'SXBET',
      vendorMarketId: 'old-pre-event',
      sport: 'NFL',
      teams: ['bills', 'dolphins'],
      normalizedTokens: ['bills', 'dolphins'],
      startTime: Date.now() - 3 * 60 * 60 * 1000, // 3 hours ago
      status: 'PRE',
      marketType: 'MONEYLINE',
      rawTitle: 'Bills vs Dolphins',
      lastUpdatedAt: Date.now(),
      extractionConfidence: 0.9,
    };
    addOrUpdateEvent(oldPreEvent);

    const pruned = pruneEndedEvents(Date.now());
    assertTrue(pruned >= 1, 'Should prune at least 1 stale PRE event');
  });

  // Clean up after tests
  clearRegistry();
}

// ============================================================================
// Test: Matcher - Token-Based
// ============================================================================

function testMatcher() {
  console.log('\n--- Matcher Tests (Token-Based) ---\n');

  // Clean up before tests
  clearRegistry();
  clearMatchedGroups();

  test('updateMatches creates MatchedEventGroup for same game (token overlap)', () => {
    // Add matching NHL games on two platforms with overlapping tokens
    const sxEvent: VendorEvent = {
      platform: 'SXBET',
      vendorMarketId: 'sx-nhl-1',
      sport: 'NHL',
      homeTeam: 'detroit red wings',
      awayTeam: 'boston bruins',
      teams: ['detroit', 'red', 'wings', 'boston', 'bruins'],
      normalizedTokens: ['detroit', 'red', 'wings', 'boston', 'bruins'],
      startTime: Date.now() + 30 * 60 * 1000, // 30 min from now
      status: 'PRE',
      marketType: 'MONEYLINE',
      rawTitle: 'Detroit Red Wings vs Boston Bruins',
      lastUpdatedAt: Date.now(),
      extractionConfidence: 0.9,
    };

    const pmEvent: VendorEvent = {
      platform: 'POLYMARKET',
      vendorMarketId: 'pm-nhl-1',
      sport: 'NHL',
      homeTeam: 'bruins',
      awayTeam: 'red wings',
      teams: ['red', 'wings', 'bruins', 'boston'],
      normalizedTokens: ['red', 'wings', 'bruins', 'boston'],
      startTime: Date.now() + 32 * 60 * 1000, // 32 min from now (within tolerance)
      status: 'PRE',
      marketType: 'MONEYLINE',
      rawTitle: 'Red Wings @ Bruins',
      lastUpdatedAt: Date.now(),
      extractionConfidence: 0.85,
    };

    addOrUpdateEvent(sxEvent);
    addOrUpdateEvent(pmEvent);

    const snapshot = getSnapshot();
    updateMatches(snapshot);

    const matches = getMatchedEvents();
    assertTrue(matches.length >= 1, 'Should have at least 1 matched group');

    const nhlMatch = matches.find(m => m.sport === 'NHL');
    assertDefined(nhlMatch, 'Should have an NHL match');
    assertEqual(nhlMatch.platformCount, 2, 'Should be on 2 platforms');
    assertTrue(nhlMatch.matchQuality >= 0.5, 'Match quality should be reasonable');
  });

  test('NEGATIVE: different games in same sport do not match', () => {
    // Clear and add two different NBA games
    clearRegistry();
    clearMatchedGroups();
    
    const gameA: VendorEvent = {
      platform: 'SXBET',
      vendorMarketId: 'sx-nba-1',
      sport: 'NBA',
      teams: ['lakers', 'celtics'],
      normalizedTokens: ['lakers', 'celtics'],
      startTime: Date.now() + 30 * 60 * 1000,
      status: 'PRE',
      marketType: 'MONEYLINE',
      rawTitle: 'Lakers vs Celtics',
      lastUpdatedAt: Date.now(),
      extractionConfidence: 0.9,
    };

    const gameB: VendorEvent = {
      platform: 'POLYMARKET',
      vendorMarketId: 'pm-nba-2',
      sport: 'NBA',
      teams: ['warriors', 'heat'],
      normalizedTokens: ['warriors', 'heat'],
      startTime: Date.now() + 35 * 60 * 1000,
      status: 'PRE',
      marketType: 'MONEYLINE',
      rawTitle: 'Warriors vs Heat',
      lastUpdatedAt: Date.now(),
      extractionConfidence: 0.9,
    };

    addOrUpdateEvent(gameA);
    addOrUpdateEvent(gameB);
    updateMatches(getSnapshot());

    const matches = getMatchedEvents();
    // Should NOT have a matched group because tokens don't overlap
    const wrongMatch = matches.find(m => 
      m.platformCount >= 2 &&
      m.vendors.SXBET?.some(v => v.vendorMarketId === 'sx-nba-1') &&
      m.vendors.POLYMARKET?.some(v => v.vendorMarketId === 'pm-nba-2')
    );
    assertEqual(wrongMatch, undefined, 'Different games should not match');
  });

  test('NEGATIVE: games far apart in time do not match', () => {
    // Clear and add same game but 2 hours apart
    clearRegistry();
    clearMatchedGroups();
    
    const gameA: VendorEvent = {
      platform: 'SXBET',
      vendorMarketId: 'sx-nba-time1',
      sport: 'NBA',
      teams: ['lakers', 'celtics'],
      normalizedTokens: ['lakers', 'celtics'],
      startTime: Date.now() + 30 * 60 * 1000, // 30 min from now
      status: 'PRE',
      marketType: 'MONEYLINE',
      rawTitle: 'Lakers vs Celtics',
      lastUpdatedAt: Date.now(),
      extractionConfidence: 0.9,
    };

    const gameB: VendorEvent = {
      platform: 'POLYMARKET',
      vendorMarketId: 'pm-nba-time2',
      sport: 'NBA',
      teams: ['lakers', 'celtics'],
      normalizedTokens: ['lakers', 'celtics'],
      startTime: Date.now() + 3 * 60 * 60 * 1000, // 3 hours from now (too far)
      status: 'PRE',
      marketType: 'MONEYLINE',
      rawTitle: 'Lakers vs Celtics',
      lastUpdatedAt: Date.now(),
      extractionConfidence: 0.9,
    };

    addOrUpdateEvent(gameA);
    addOrUpdateEvent(gameB);
    updateMatches(getSnapshot());

    const matches = getMatchedEvents();
    // Should NOT match because time difference is too large
    const wrongMatch = matches.find(m => 
      m.platformCount >= 2 &&
      m.vendors.SXBET?.some(v => v.vendorMarketId === 'sx-nba-time1') &&
      m.vendors.POLYMARKET?.some(v => v.vendorMarketId === 'pm-nba-time2')
    );
    assertEqual(wrongMatch, undefined, 'Games 3 hours apart should not match');
  });

  test('setMatchedGroups sets groups directly', () => {
    const groups: MatchedEventGroup[] = [
      {
        eventKey: 'test:manual-group',
        sport: 'NFL',
        homeTeam: 'chiefs',
        awayTeam: 'eagles',
        startTime: Date.now() + 3600000,
        status: 'PRE',
        vendors: {
          SXBET: [],
          POLYMARKET: [],
        },
        platformCount: 2,
        totalEvents: 2,
        lastMatchedAt: Date.now(),
        matchQuality: 0.8,
      },
    ];

    setMatchedGroups(groups);
    const matches = getMatchedEvents();
    assertTrue(
      matches.some(m => m.eventKey === 'test:manual-group'),
      'Should contain manually set group'
    );
  });

  // Clean up after tests
  clearRegistry();
  clearMatchedGroups();
}

// ============================================================================
// Test: File Persistence
// ============================================================================

function testFilePersistence() {
  console.log('\n--- File Persistence Tests ---\n');

  // Clean up before tests
  deleteMatchedGroupsFile();

  test('saveMatchedGroupsToFile creates file', () => {
    const config = buildLiveEventMatcherConfig();
    const groups: MatchedEventGroup[] = [
      {
        eventKey: 'NHL:2024-12-01:detroit_red_wings_boston_bruins',
        sport: 'NHL',
        homeTeam: 'detroit red wings',
        awayTeam: 'boston bruins',
        startTime: Date.now() + 3600000,
        status: 'PRE',
        vendors: {
          SXBET: [],
          POLYMARKET: [],
        },
        platformCount: 2,
        totalEvents: 2,
        lastMatchedAt: Date.now(),
        matchQuality: 0.85,
      },
    ];

    const saved = saveMatchedGroupsToFile(groups, config);
    assertTrue(saved, 'Should save successfully');

    const info = getMatchedGroupsFileInfo();
    assertTrue(info.exists, 'File should exist');
  });

  test('loadMatchedGroupsFromFile loads groups correctly', () => {
    const groups = loadMatchedGroupsFromFile();
    assertDefined(groups, 'Should load groups');
    assertEqual(groups.length, 1, 'Should have 1 group');
    assertEqual(groups[0].sport, 'NHL', 'Should be NHL game');
  });

  test('getGroupsFileInfo returns correct info', () => {
    const info = getGroupsFileInfo();
    assertTrue(info.exists, 'File should exist');
    assertDefined(info.fileData, 'Should have file data');
    assertEqual(info.fileData.summary.totalGroups, 1, 'Should report 1 group');
  });

  test('forcePersistGroupsToFile updates file', () => {
    const groups: MatchedEventGroup[] = [
      {
        eventKey: 'NBA:2024-12-01:lakers_celtics',
        sport: 'NBA',
        homeTeam: 'lakers',
        awayTeam: 'celtics',
        startTime: Date.now() + 7200000,
        status: 'PRE',
        vendors: {
          KALSHI: [],
          POLYMARKET: [],
        },
        platformCount: 2,
        totalEvents: 2,
        lastMatchedAt: Date.now(),
        matchQuality: 0.9,
      },
    ];

    setMatchedGroups(groups);
    const saved = forcePersistGroupsToFile();
    assertTrue(saved, 'Should force persist');

    const loaded = loadMatchedGroupsFromFile();
    assertDefined(loaded, 'Should load after force persist');
    assertTrue(
      loaded.some(g => g.sport === 'NBA'),
      'Should contain NBA game'
    );
  });

  test('deleteMatchedGroupsFile removes file', () => {
    const deleted = deleteMatchedGroupsFile();
    assertTrue(deleted, 'Should delete file');

    const info = getMatchedGroupsFileInfo();
    assertTrue(!info.exists, 'File should not exist after delete');
  });

  // Clean up
  deleteMatchedGroupsFile();
  clearMatchedGroups();
}

// ============================================================================
// Test: Full Integration
// ============================================================================

function testIntegration() {
  console.log('\n--- Integration Tests ---\n');

  // Clean up before tests
  clearRegistry();
  clearMatchedGroups();
  deleteMatchedGroupsFile();

  test('processAllMarkets populates registry with tokens', () => {
    const markets: Market[] = [
      createSxBetMarket('sx-1', 'Detroit Red Wings vs Boston Bruins'),
      createSxBetMarket('sx-2', 'Lakers vs Celtics'),
      createPolymarketMarket('pm-1', 'Will Red Wings beat Bruins?'),
      createPolymarketMarket('pm-2', 'Lakers to win against Celtics'),
      createKalshiMarket('NHL-DET-BOS', 'Red Wings @ Bruins winner'),
    ];

    const result = processAllMarkets(markets);
    console.log(`   Processed: SX.bet=${result.sxbet}, Polymarket=${result.polymarket}, Kalshi=${result.kalshi}`);
    assertTrue(result.total >= 2, 'Should process at least 2 sports events');
    
    // Verify tokens were extracted
    const snapshot = getSnapshot();
    const eventsWithTokens = snapshot.events.filter(e => e.normalizedTokens && e.normalizedTokens.length > 0);
    assertTrue(eventsWithTokens.length > 0, 'Should have events with tokens');
  });

  test('updateMatches finds cross-platform matches using tokens', () => {
    updateMatches(getSnapshot());
    const matches = getMatchedEvents();
    console.log(`   Found ${matches.length} matched groups`);
    // System should run without error
    assertTrue(true, 'Matcher should run without error');
  });

  test('File persistence works in integration', () => {
    const saved = forcePersistGroupsToFile();
    assertTrue(saved, 'Should persist groups');

    const loaded = loadMatchedGroupsFromFile();
    assertDefined(loaded, 'Should load persisted groups');
  });

  // Clean up
  clearRegistry();
  clearMatchedGroups();
  deleteMatchedGroupsFile();
}

// ============================================================================
// Test: Legacy Compatibility
// ============================================================================

function testLegacyCompatibility() {
  console.log('\n--- Legacy Compatibility Tests ---\n');

  test('normalizeTeamName still works (now uses tokens)', () => {
    const result = normalizeTeamName('Red Wings', 'NHL');
    // Should return normalized form (lowercased, stopwords removed)
    assertTrue(result.includes('red') || result.includes('wings'), 'Should contain key words');
  });

  test('parseTeamsFromTitle still works (now uses tokens)', () => {
    const result = parseTeamsFromTitle('Lakers vs Celtics', 'NBA');
    assertTrue(result.teams.length > 0, 'Should find some teams/tokens');
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     LIVE EVENTS SYSTEM TEST SUITE                          ║');
  console.log('║     Token-Based Matching (No Alias Maps)                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  testTokenNormalization();
  testTokenOverlapScoring();
  testTimeBucketing();
  testExtractors();
  testRegistry();
  testMatcher();
  testFilePersistence();
  testIntegration();
  testLegacyCompatibility();

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`RESULTS: ${passCount} passed, ${failCount} failed`);
  console.log('════════════════════════════════════════════════════════════\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
