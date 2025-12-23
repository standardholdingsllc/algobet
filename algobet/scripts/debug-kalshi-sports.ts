#!/usr/bin/env node
import {
  KalshiAPI,
  DEFAULT_KALSHI_MIN_CLOSE_WINDOW_MINUTES,
} from '@/lib/markets/kalshi';
import { createKalshiVendorEvent } from '@/lib/live-event-extractors';
import { VendorEvent } from '@/types/live-events';

async function main(): Promise<void> {
  const kalshiApi = new KalshiAPI();
  const windowDays = 30;
  console.log(`🔍 Fetching Kalshi markets for sports debug (next ${windowDays} days)...\n`);

  const markets = await kalshiApi.getOpenMarkets({
    maxCloseMinutes: windowDays * 24 * 60,
    minCloseMinutes: DEFAULT_KALSHI_MIN_CLOSE_WINDOW_MINUTES,
    status: 'open',
    sportsOnly: true,
  });
  const events: VendorEvent[] = [];

  for (const market of markets) {
    const event = createKalshiVendorEvent(market);
    if (event && event.teams.length >= 2) {
      events.push(event);
    }
  }

  events.sort((a, b) => {
    const aTime = a.startTime ?? 0;
    const bTime = b.startTime ?? 0;
    return aTime - bTime;
  });

  console.log(
    `Found ${events.length} Kalshi sports events in the next ${windowDays} days (showing up to 20):\n`
  );

  events.slice(0, 20).forEach((event, idx) => {
    const when = event.startTime ? new Date(event.startTime).toISOString() : 'unknown';
    const matchup = `${event.awayTeam ?? '?'} @ ${event.homeTeam ?? '?'}`;
    console.log(
      `${idx + 1}. [${event.sport}] ${matchup} | start=${when} | ticker=${event.vendorMarketId}`
    );
  });

  if (events.length === 0) {
    console.log('No sports events detected. Try increasing the window or check Kalshi availability.');
  }
}

main().catch((error) => {
  console.error('❌ debug-kalshi-sports failed:', error);
  process.exit(1);
});

