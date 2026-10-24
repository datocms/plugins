import isEqual from 'lodash-es/isEqual';
import { useRef } from 'react';

/**
 * The same reference for as long as the value stays deeply equal. The host
 * sends a new ctx (with new objects) on every change, so a value from it
 * would otherwise restart the effects and memos that depend on it.
 */
export function useDeepStableValue<T>(value: T): T {
  const valueRef = useRef(value);

  if (!isEqual(valueRef.current, value)) {
    valueRef.current = value;
  }

  return valueRef.current;
}
