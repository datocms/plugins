const sessionCache = new Map<string, unknown>();

export function getSessionCacheValue<T>(key: string): T | undefined {
  return sessionCache.get(key) as T | undefined;
}

export function setSessionCacheValue<T>(key: string, value: T) {
  sessionCache.set(key, value);
}

export function clearSessionCacheValue(key: string) {
  sessionCache.delete(key);
}

export function clearAllSessionCache() {
  sessionCache.clear();
}
