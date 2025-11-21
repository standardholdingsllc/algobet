import { derivePolymarketExpiry } from '../lib/markets/polymarket';

interface TestCase {
  name: string;
  fields: Parameters<typeof derivePolymarketExpiry>[0];
  expectedSource: string | undefined;
  expectedIsoPrefix: string | null;
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const now = new Date();
const later = new Date(now.getTime() + 60 * 60 * 1000);

const testCases: TestCase[] = [
  {
    name: 'uses gameStartTime even without sports metadata',
    fields: {
      gameStartTime: later.toISOString(),
      eventStartTime: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      endDate: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      endDateIso: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      umaEndDate: null,
      umaEndDateIso: null,
      startDate: null,
      startDateIso: null,
      sportsMarketType: null,
      gameId: null,
    },
    expectedSource: 'gameStartTime',
    expectedIsoPrefix: later.toISOString().slice(0, 16),
  },
  {
    name: 'falls back to eventStartTime when gameStartTime missing',
    fields: {
      gameStartTime: null,
      eventStartTime: later.toISOString(),
      endDate: null,
      endDateIso: null,
      umaEndDate: null,
      umaEndDateIso: null,
      startDate: null,
      startDateIso: null,
      sportsMarketType: 'nfl',
      gameId: 'abc',
    },
    expectedSource: 'eventStartTime',
    expectedIsoPrefix: later.toISOString().slice(0, 16),
  },
  {
    name: 'uses endDateIso when no sports timestamps available',
    fields: {
      gameStartTime: null,
      eventStartTime: null,
      endDateIso: later.toISOString(),
      endDate: later.toISOString(),
      umaEndDate: null,
      umaEndDateIso: null,
      startDate: null,
      startDateIso: null,
      sportsMarketType: null,
      gameId: null,
    },
    expectedSource: 'endDateIso',
    expectedIsoPrefix: later.toISOString().slice(0, 16),
  },
];

console.log('🧪 Testing derivePolymarketExpiry...');

testCases.forEach((testCase) => {
  const result = derivePolymarketExpiry(testCase.fields);
  assert(
    result.source === testCase.expectedSource,
    `[${testCase.name}] Expected source ${testCase.expectedSource}, received ${result.source}`
  );
  if (testCase.expectedIsoPrefix && result.iso) {
    assert(
      result.iso.startsWith(testCase.expectedIsoPrefix),
      `[${testCase.name}] Expected iso to start with ${testCase.expectedIsoPrefix}, received ${result.iso}`
    );
  }
});

console.log('✅ derivePolymarketExpiry tests passed.');

