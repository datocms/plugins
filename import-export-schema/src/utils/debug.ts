const DEFAULT_FLAG = 'schemaDebug';

function readFlag(flag: string): boolean {
  try {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage?.getItem(flag) === '1';
  } catch {
    return false;
  }
}

export function isDebugFlagEnabled(flag: string = DEFAULT_FLAG): boolean {
  return readFlag(flag);
}

export function debugLog(
  message: string,
  payload?: unknown,
  flag: string = DEFAULT_FLAG,
) {
  if (!readFlag(flag)) {
    return;
  }
  if (payload === undefined) {
    console.log(`[${flag}] ${message}`);
  } else {
    console.log(`[${flag}] ${message}`, payload);
  }
}
