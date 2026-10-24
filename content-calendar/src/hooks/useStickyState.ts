import { useEffect, useState } from 'react';

function readStoredValue<T>(
  key: string,
  defaultValue: T,
  isValid?: (value: unknown) => value is T,
): T {
  try {
    const stickyValue = window.localStorage.getItem(key);

    if (stickyValue === null) {
      return defaultValue;
    }

    const parsed: unknown = JSON.parse(stickyValue);

    if (isValid && !isValid(parsed)) {
      return defaultValue;
    }

    return parsed as T;
  } catch {
    return defaultValue;
  }
}

/**
 * A state that the browser keeps in localStorage, as JSON, under `key`.
 * A missing, broken or invalid stored value (see `isValid`) gives the
 * default value. When the storage is not available, the state stays in
 * memory.
 */
export function useStickyState<T>(
  defaultValue: T,
  key: string,
  isValid?: (value: unknown) => value is T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    readStoredValue(key, defaultValue, isValid),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The storage is full or blocked: the value stays in memory
    }
  }, [key, value]);

  return [value, setValue];
}
