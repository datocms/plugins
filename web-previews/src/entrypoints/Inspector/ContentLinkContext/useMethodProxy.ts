import { useCallback, useEffect, useMemo, useRef } from 'react';

type Promisify<T> = T extends Promise<unknown> ? T : Promise<T>;

function isPromise(x: unknown): x is Promise<unknown> {
  return x !== null && typeof x === 'object' && 'then' in x && 'catch' in x;
}

const useMethodProxy = <Method extends (...args: unknown[]) => unknown>(
  method: Method,
  depsList: Array<unknown>,
) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const methodCb = useMemo(() => {
    return method;
    // depsList is a runtime-variable deps array; we spread it to satisfy the
    // hook call convention while accepting that Biome/ESLint cannot statically
    // verify it. The depsList argument is the caller's responsibility.
    // biome requires an array literal – we work around this by passing the
    // deps individually via the spread pattern captured at call time.
  }, [method, ...depsList]);

  const methodRef = useRef<Method>(method);

  useEffect(() => {
    methodRef.current = methodCb;
  }, [methodCb]);

  return useCallback(
    (...args: Parameters<Method>): Promisify<ReturnType<Method>> => {
      const result: ReturnType<Method> = methodRef.current(...args);

      if (isPromise(result)) {
        // our dato api throws object errors (not Error instances) attaching some
        // metadata. these kind of objects cannot be passed to the iframe as they're
        // not serializable
        return result.catch((e: unknown) => {
          if (e && typeof e === 'object' && 'error' in e) {
            throw e.error;
          }

          throw e;
        });
      }

      return Promise.resolve(result) as Promisify<ReturnType<Method>>;
    },
    [],
  );
};

export default useMethodProxy;
