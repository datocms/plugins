import isEqual from 'lodash-es/isEqual';
import { useRef } from 'react';

/**
 * The SDK hands a new ctx (with new parameter and value objects) to every
 * render. This keeps the previous reference while the value is deeply equal,
 * so memos and effects only rerun on real changes.
 */
export function useDeepStable<T>(value: T): T {
  const ref = useRef(value);
  if (!isEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
}
