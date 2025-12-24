/**
 * Live Sports Discovery Types and Utilities
 */

export interface CombinedLiveSportsResult {
  kalshi?: {
    events: any[];
    error?: string;
  };
  polymarket?: {
    events: any[];
    error?: string;
  };
  timestamp: string;
  duration: number;
}

/**
 * Get the typical game duration in hours for a Kalshi sports series
 * Based on the series ticker pattern
 */
export function getKalshiGameDurationHours(seriesTicker: string): number {
  // NFL games typically last about 3 hours
  if (seriesTicker.includes('NFL') || seriesTicker.includes('FOOTBALL')) {
    return 3;
  }

  // NBA games typically last about 2.5 hours
  if (seriesTicker.includes('NBA') || seriesTicker.includes('BASKETBALL')) {
    return 2.5;
  }

  // MLB games typically last about 3.5 hours
  if (seriesTicker.includes('MLB') || seriesTicker.includes('BASEBALL')) {
    return 3.5;
  }

  // NHL games typically last about 2.5 hours
  if (seriesTicker.includes('NHL') || seriesTicker.includes('HOCKEY')) {
    return 2.5;
  }

  // Soccer games typically last about 2 hours
  if (seriesTicker.includes('SOCCER') || seriesTicker.includes('EPL') ||
      seriesTicker.includes('PREMIER') || seriesTicker.includes('CHAMPIONS')) {
    return 2;
  }

  // Tennis matches typically last 2-3 hours
  if (seriesTicker.includes('TENNIS') || seriesTicker.includes('WTA') ||
      seriesTicker.includes('ATP')) {
    return 2.5;
  }

  // Golf tournaments can last all day (18+ hours)
  if (seriesTicker.includes('GOLF') || seriesTicker.includes('PGA')) {
    return 18;
  }

  // Boxing/MMA fights typically last 1-2 hours
  if (seriesTicker.includes('BOXING') || seriesTicker.includes('MMA') ||
      seriesTicker.includes('UFC')) {
    return 1.5;
  }

  // Default to 2 hours for unknown sports
  return 2;
}
