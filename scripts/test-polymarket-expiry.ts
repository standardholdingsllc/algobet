import { derivePolymarketExpiry } from '../lib/markets/polymarket';

interface TestCase {
  name: string;
  fields: Parameters<typeof derivePolymarketExpiry>[0];
  expectedSource: string | undefined;
  expectedIso: string | null;
  assertAfterWindowStart?: string;
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const testCases: TestCase[] = [
  {
    name: 'non-sports MrBeast market prefers endDateIso',
    fields: {
      question: 'Will another MrBeast video get 100m+ week 1 views by November 30?',
      gameStartTime: '2025-09-26T15:49:00.000Z',
      eventStartTime: null,
      endDateIso: '2025-11-30T00:00:00.000Z',
      endDate: '2025-11-30T00:00:00.000Z',
      umaEndDate: null,
      umaEndDateIso: null,
      startDate: null,
      startDateIso: null,
      sportsMarketType: null,
      gameId: null,
    },
    expectedSource: 'endDateIso',
    expectedIso: '2025-11-30T00:00:00.000Z',
    assertAfterWindowStart: '2025-11-21T06:15:23.644Z',
  },
  {
    name: 'non-sports Bitcoin-by-date ignores gameStartTime',
    fields: {
      question: 'Another S&P 500 Company buys Bitcoin by November 30?',
      gameStartTime: '2025-11-04T21:21:00.000Z',
      eventStartTime: null,
      endDateIso: '2025-11-30T00:00:00.000Z',
      endDate: '2025-11-30T00:00:00.000Z',
      umaEndDate: null,
      umaEndDateIso: null,
      startDate: null,
      startDateIso: null,
      sportsMarketType: null,
      gameId: null,
    },
    expectedSource: 'endDateIso',
    expectedIso: '2025-11-30T00:00:00.000Z',
    assertAfterWindowStart: '2025-11-21T06:15:23.644Z',
  },
  {
    name: 'sports Preston market still uses gameStartTime',
    fields: {
      question: 'Will Preston North End FC win on 2025-11-21?',
      gameStartTime: '2025-11-21T20:00:00.000Z',
      eventStartTime: null,
      endDateIso: '2025-11-21T00:00:00.000Z',
      endDate: '2025-11-21T00:00:00.000Z',
      umaEndDate: null,
      umaEndDateIso: null,
      startDate: null,
      startDateIso: null,
      sportsMarketType: null,
      gameId: null,
    },
    expectedSource: 'gameStartTime',
    expectedIso: '2025-11-21T20:00:00.000Z',
  },
];

console.log('🧪 Testing derivePolymarketExpiry...');

testCases.forEach((testCase) => {
  const result = derivePolymarketExpiry(testCase.fields);
  assert(
    result.source === testCase.expectedSource,
    `[${testCase.name}] Expected source ${testCase.expectedSource}, received ${result.source}`
  );
  assert(
    result.iso === testCase.expectedIso,
    `[${testCase.name}] Expected iso ${testCase.expectedIso}, received ${result.iso}`
  );
  if (testCase.assertAfterWindowStart) {
    const expiryTs = result.iso ? Date.parse(result.iso) : NaN;
    const windowStartTs = Date.parse(testCase.assertAfterWindowStart);
    assert(
      !Number.isNaN(expiryTs) && expiryTs > windowStartTs,
      `[${testCase.name}] Expected expiry ${result.iso} to be after windowStart ${testCase.assertAfterWindowStart}`
    );
  }
});

console.log('✅ derivePolymarketExpiry tests passed.');

