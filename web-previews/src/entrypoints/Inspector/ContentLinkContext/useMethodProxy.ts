import { useCallback, useEffect, useMemo, useRef } from 'react';

type Promisify<T> = T extends Promise<unknown> ? T : Promise<T>;

function isPromise(x: any): x is Promise<unknown> {
  return typeof x === 'object' && 'then' in x && 'catch' in x;
}

const useMethodProxy = <Method extends (...args: any) => any>(
  method: Method,
  depsList: Array<unknown>,
) => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  const methodCb = useMemo(() => {
    return method;
  }, depsList);

  const methodRef = useRef<Method>(method);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    methodRef.current = methodCb;
  }, [method]);

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
