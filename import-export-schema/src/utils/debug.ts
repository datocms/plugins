export function isDebug(flag = 'schemaDebug'): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.localStorage?.getItem(flag) === '1'
    );
  } catch {
    return false;
  }
}

export function debugLog(flag = 'schemaDebug', ...args: unknown[]) {
  if (isDebug(flag)) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}
