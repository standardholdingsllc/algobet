// Test market matching algorithm

const { 
  parseMarket, 
  calculateMarketSimilarity,
  findMatchingMarkets,
  explainMatch,
  addEntityMapping
} = require('../lib/market-matching.ts');

console.log('🧪 Testing Market Matching Algorithm\n');
console.log('=' .repeat(70));

// Test cases: pairs that should match despite different wording
const testCases = [
  {
    title1: 'Will Bitcoin close above $50,000 on October 31st?',
    title2: 'Price of BTC at end of October above 50k?',
    platform1: 'kalshi',
    platform2: 'polymarket',
    shouldMatch: true,
  },
  {
    title1: 'Dodgers vs Yankees - who will win?',
    title2: 'Will the Yankees beat the Dodgers?',
    platform1: 'kalshi',
    platform2: 'polymarket',
    shouldMatch: true,
  },
  {
    title1: 'Temperature in NYC above 70°F on Dec 25',
    title2: 'Will NYC temperature exceed 70 degrees on December 25th?',
    platform1: 'kalshi',
    platform2: 'polymarket',
    shouldMatch: true,
  },
  {
    title1: 'S&P 500 close above 5000 on Friday',
    title2: 'Will SP500 index be over 5000 at market close?',
    platform1: 'kalshi',
    platform2: 'polymarket',
    shouldMatch: true,
  },
  {
    title1: 'Fed rate cut by 0.25% in December',
    title2: 'Federal Reserve cuts rates by 25 basis points Dec',
    platform1: 'kalshi',
    platform2: 'polymarket',
    shouldMatch: true,
  },
  {
    title1: 'Lakers win against the Celtics',
    title2: 'Will the Dodgers beat the Yankees?', // Different teams!
    platform1: 'kalshi',
    platform2: 'polymarket',
    shouldMatch: false,
  },
  {
    title1: 'Bitcoin above $50,000',
    title2: 'Ethereum above $3,000', // Different crypto!
    platform1: 'kalshi',
    platform2: 'polymarket',
    shouldMatch: false,
  },
];

console.log('\n📊 Test Results:\n');

let passed = 0;
let failed = 0;

for (let i = 0; i < testCases.length; i++) {
  const test = testCases[i];
  
  // Create mock market objects
  const market1 = {
    id: `test1-${i}`,
    platform: test.platform1,
    ticker: `TEST1-${i}`,
    title: test.title1,
    yesPrice: 50,
    noPrice: 50,
    volume: 1000,
    expiryDate: new Date('2024-12-31'),
    eventTicker: `EVENT1-${i}`,
    fee: 1.5,
  };
  
  const market2 = {
    id: `test2-${i}`,
    platform: test.platform2,
    ticker: `TEST2-${i}`,
    title: test.title2,
    yesPrice: 48,
    noPrice: 52,
    volume: 1000,
    expiryDate: new Date('2024-12-31'),
    eventTicker: `EVENT2-${i}`,
    fee: 2.0,
  };
  
  // Parse and calculate similarity
  const parsed1 = parseMarket(market1);
  const parsed2 = parseMarket(market2);
  const similarity = calculateMarketSimilarity(parsed1, parsed2);
  
  // Check if match meets threshold (70%)
  const matchFound = similarity >= 0.7;
  const correct = matchFound === test.shouldMatch;
  
  const status = correct ? '✅' : '❌';
  const color = correct ? '' : '\x1b[31m';
  const reset = '\x1b[0m';
  
  console.log(`${status} Test ${i + 1}: ${test.shouldMatch ? 'Should Match' : 'Should NOT Match'}`);
  console.log(`   "${test.title1}"`);
  console.log(`   "${test.title2}"`);
  console.log(`   ${color}Similarity: ${(similarity * 100).toFixed(1)}%${reset}`);
  console.log();
  
  if (correct) passed++;
  else failed++;
  
  // Show detailed breakdown for failures
  if (!correct) {
    console.log('   Detailed Analysis:');
    console.log('   ' + explainMatch(parsed1, parsed2).split('\n').join('\n   '));
    console.log();
  }
}

console.log('─'.repeat(70));
console.log(`\n📈 Results: ${passed}/${testCases.length} passed\n`);

// Show example of adding custom mappings
console.log('=' .repeat(70));
console.log('\n💡 Custom Entity Mappings:\n');

console.log('Adding custom mapping: "knicks" → "new york knicks"');
addEntityMapping(['knicks', 'ny knicks'], 'new york knicks');

console.log('Adding custom mapping: "btc" → "bitcoin"');
addEntityMapping(['btc', 'bitcoin', 'btc/usd'], 'bitcoin');

console.log('\n✨ Custom mappings added! These will improve future matches.');

console.log('\n' + '=' .repeat(70));
console.log('\n🎯 Key Features:\n');

console.log('✅ Entity extraction (teams, stocks, people, places)');
console.log('✅ Date parsing (October 31st = Oct 31 = 10/31)');
console.log('✅ Number extraction ($50,000 = 50k = 50000)');
console.log('✅ Abbreviation handling (BTC = Bitcoin, Fed = Federal Reserve)');
console.log('✅ Direction detection (above/below, wins/loses)');
console.log('✅ Fuzzy matching for complex titles');
console.log('✅ Opposing direction handling (flip YES/NO sides)');

console.log('\n' + '=' .repeat(70));
console.log('\n📚 Examples of Matches It Will Find:\n');

const examples = [
  [
    'Bitcoin price above $50k on Oct 31',
    'Will BTC close over 50000 on October 31st?'
  ],
  [
    'Lakers beat Celtics in Game 7',
    'Will the Boston Celtics lose to the LA Lakers?'
  ],
  [
    'Fed cuts rates by 0.25% in December',
    'Federal Reserve 25 basis point rate cut Dec 2024'
  ],
  [
    'S&P500 closes above 5000',
    'Will the S&P 500 index exceed 5000 at close?'
  ],
];

examples.forEach(([ex1, ex2], i) => {
  console.log(`${i + 1}. "${ex1}"`);
  console.log(`   ↔ "${ex2}"`);
  console.log();
});

console.log('✨ Market Matching Tests Complete!\n');


