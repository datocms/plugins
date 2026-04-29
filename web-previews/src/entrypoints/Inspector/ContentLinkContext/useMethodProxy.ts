import { useCallback, useEffect, useMemo, useRef } from 'react';

type Promisify<T> = T extends Promise<unknown> ? T : Promise<T>;

function isPromise(x: unknown): x is Promise<unknown> {
  return x !== null && typeof x === 'object' && 'then' in x && 'catch' in x;
}

const useMethodProxy = <Args extends unknown[], R>(
  method: (...args: Args) => R,
  depsList: Array<unknown>,
) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const methodCb = useMemo(() => method, [method, ...depsList]);

  const methodRef = useRef(methodCb);

  useEffect(() => {
    methodRef.current = methodCb;
  }, [methodCb]);

  return useCallback((...args: Args): Promisify<R> => {
    const result = methodRef.current(...args);

    if (isPromise(result)) {
      // our dato api throws object errors (not Error instances) attaching some
      // metadata. these kind of objects cannot be passed to the iframe as they're
      // not serializable
      return result.catch((e: unknown) => {
        if (e && typeof e === 'object' && 'error' in e) {
          throw e.error;
        }

        throw e;
      }) as Promisify<R>;
    }

    return Promise.resolve(result) as Promisify<R>;
  }, []);
};

export default useMethodProxy;
