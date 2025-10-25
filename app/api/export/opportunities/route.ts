import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GitHubStorage } from '@/lib/github-storage';
import Papa from 'papaparse';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = cookieStore.get('algobet_session');
  
  if (session?.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const searchParams = request.nextUrl.searchParams;
  const format = searchParams.get('format') || 'csv';
  
  try {
    const dataStore = await GitHubStorage.getDataStore();
    const opportunities = dataStore.opportunities.map(opp => ({
      id: opp.id,
      timestamp: opp.timestamp,
      market1_platform: opp.market1.platform,
      market1_ticker: opp.market1.ticker,
      market1_price: opp.market1.yesPrice,
      market2_platform: opp.market2.platform,
      market2_ticker: opp.market2.ticker,
      market2_price: opp.market2.noPrice,
      profit_percentage: opp.profitPercentage,
      net_profit: opp.netProfit,
      status: opp.status,
      expiry_date: opp.expiryDate,
    }));
    
    if (format === 'json') {
      return new NextResponse(JSON.stringify(opportunities, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename=opportunities.json',
        },
      });
    } else {
      const csv = Papa.unparse(opportunities);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=opportunities.csv',
        },
      });
    }
  } catch (error) {
    console.error('Error exporting opportunities:', error);
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}

