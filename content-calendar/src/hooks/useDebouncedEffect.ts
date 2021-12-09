import { useEffect, useRef } from 'react';

export function useDebouncedEffect(
  callback: React.EffectCallback,
  delay: number,
  deps: React.DependencyList = [],
) {
  const data = useRef<{
    firstTime: boolean;
    clearFunc: ReturnType<React.EffectCallback>;
  }>({
    firstTime: true,
    clearFunc: undefined,
  });

  useEffect(() => {
    const { firstTime, clearFunc } = data.current;

    if (firstTime) {
      data.current.firstTime = false;
      return;
    }

    const handler = setTimeout(() => {
      if (clearFunc && typeof clearFunc === 'function') {
        clearFunc();
      }
      data.current.clearFunc = callback();
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, ...deps]);
}

export default useDebouncedEffect;
