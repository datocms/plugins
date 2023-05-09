import { useEffect, useState } from 'react';

type PromiseFactory = () => Promise<any>;

export function useAsyncEffect(
  effect: PromiseFactory,
  deps?: React.DependencyList | undefined,
) {
  const setState = useState<boolean>()[1];

  return useEffect(() => {
    async function safeRunner() {
      try {
        await effect();
      } catch (e) {
        setState(() => {
          throw e;
        });
      }
    }

    safeRunner();
  }, deps);
}

export async function promiseAllWithProgress(
  promises: Promise<unknown>[],
  cb: (completed: number, total: number) => void,
) {
  let completed = 0;
  cb(completed, promises.length);
  await Promise.all(
    promises.map(async (promise) => {
      await promise;
      completed += 1;
      cb(completed, promises.length);
    }),
  );
}
