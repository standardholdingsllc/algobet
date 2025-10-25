import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GitHubStorage } from '@/lib/github-storage';
import { filterProfitsByDateRange } from '@/lib/utils';
import Papa from 'papaparse';
import { subDays } from 'date-fns';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = cookieStore.get('algobet_session');
  
  if (session?.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const searchParams = request.nextUrl.searchParams;
  const format = searchParams.get('format') || 'csv';
  const period = searchParams.get('period') || 'daily';
  
  try {
    const dataStore = await GitHubStorage.getDataStore();
    
    // Filter bets by period
    let cutoffDate: Date;
    switch (period) {
      case 'daily':
        cutoffDate = subDays(new Date(), 1);
        break;
      case 'weekly':
        cutoffDate = subDays(new Date(), 7);
        break;
      case 'monthly':
        cutoffDate = subDays(new Date(), 30);
        break;
      case 'yearly':
        cutoffDate = subDays(new Date(), 365);
        break;
      default:
        cutoffDate = new Date(0); // All time
    }
    
    const filteredBets = dataStore.bets
      .filter(bet => new Date(bet.placedAt) >= cutoffDate)
      .map(bet => ({
        id: bet.id,
        opportunity_id: bet.opportunityId,
        platform: bet.platform,
        market_ticker: bet.market.ticker,
        market_title: bet.market.title,
        side: bet.side,
        amount: bet.amount,
        price: bet.price,
        placed_at: bet.placedAt,
        status: bet.status,
        outcome: bet.outcome || '',
        payout: bet.payout || 0,
      }));
    
    if (format === 'json') {
      return new NextResponse(JSON.stringify(filteredBets, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename=bets_${period}.json`,
        },
      });
    } else {
      const csv = Papa.unparse(filteredBets);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename=bets_${period}.csv`,
        },
      });
    }
  } catch (error) {
    console.error('Error exporting bets:', error);
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}

