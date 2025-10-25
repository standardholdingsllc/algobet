import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GitHubStorage } from '@/lib/github-storage';
import { SystemConfig } from '@/types';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = cookieStore.get('algobet_session');
  
  if (session?.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const newConfig: SystemConfig = await request.json();
    newConfig.lastUpdated = new Date();
    
    const dataStore = await GitHubStorage.getDataStore();
    dataStore.config = newConfig;
    
    await GitHubStorage.updateDataStore(dataStore);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating config:', error);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}

