export type LiveArbLogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_PRIORITY: Record<LiveArbLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const DEFAULT_LEVEL: LiveArbLogLevel = 'info';

let currentLevel: LiveArbLogLevel = resolveLevel(process.env.LIVE_ARB_LOG_LEVEL);

function resolveLevel(value?: string): LiveArbLogLevel {
  if (!value) {
    return DEFAULT_LEVEL;
  }
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'error':
    case 'warn':
    case 'info':
    case 'debug':
      return normalized;
    default:
      return DEFAULT_LEVEL;
  }
}

export function setLiveArbLogLevel(level: LiveArbLogLevel): void {
  currentLevel = level;
}

export function refreshLiveArbLogLevelFromEnv(): void {
  currentLevel = resolveLevel(process.env.LIVE_ARB_LOG_LEVEL);
}

export function getLiveArbLogLevel(): LiveArbLogLevel {
  return currentLevel;
}

export function shouldLog(level: LiveArbLogLevel): boolean {
  return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[currentLevel];
}

type LoggableMeta = Record<string, unknown> | Error | undefined;

export function liveArbLog(
  level: LiveArbLogLevel,
  tag: string,
  message: string,
  meta?: LoggableMeta
): void {
  if (!shouldLog(level)) return;

  const prefix = `[${tag}]`;
  const text = `${prefix} ${message}`;
  const payload = meta !== undefined ? [text, meta] : [text];

  switch (level) {
    case 'error':
      console.error(...payload);
      break;
    case 'warn':
      console.warn(...payload);
      break;
    case 'info':
      console.log(...payload);
      break;
    case 'debug':
      if (typeof console.debug === 'function') {
        console.debug(...payload);
      } else {
        console.log(...payload);
      }
      break;
  }
}

export function liveArbInfo(tag: string, message: string, meta?: LoggableMeta): void {
  liveArbLog('info', tag, message, meta);
}

export function liveArbWarn(tag: string, message: string, meta?: LoggableMeta): void {
  liveArbLog('warn', tag, message, meta);
}

export function liveArbError(tag: string, message: string, meta?: LoggableMeta): void {
  liveArbLog('error', tag, message, meta);
}

export function liveArbDebug(tag: string, message: string, meta?: LoggableMeta): void {
  liveArbLog('debug', tag, message, meta);
}

