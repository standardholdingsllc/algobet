import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GitHubStorage } from '@/lib/github-storage';

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get('algobet_session');
  
  if (session?.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const dataStore = await GitHubStorage.getDataStore();
    return NextResponse.json(dataStore);
  } catch (error) {
    console.error('Error loading data:', error);
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}

