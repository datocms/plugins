import { useEffect, useState } from 'react';
import type { SizingStrategy } from '../Iframe';

interface ContainerSize {
  width: number;
  height: number;
}

export function useIframeScaling(
  sizing: SizingStrategy,
  containerRef: React.RefObject<HTMLDivElement>,
) {
  const [containerSize, setContainerSize] = useState<ContainerSize>({
    width: 0,
    height: 0,
  });
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateContainerSize = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth - 40; // Subtract padding
        const height = containerRef.current.clientHeight - 40; // Subtract padding
        setContainerSize({ width, height });
      }
    };

    updateContainerSize();
    window.addEventListener('resize', updateContainerSize);
    return () => window.removeEventListener('resize', updateContainerSize);
  }, [containerRef]);

  useEffect(() => {
    if (
      sizing !== 'responsive' &&
      containerSize.width > 0 &&
      containerSize.height > 0
    ) {
      const scaleX = containerSize.width / sizing.width;
      const scaleY = containerSize.height / sizing.height;
      setScale(Math.min(1, scaleX, scaleY));
    } else {
      setScale(1);
    }
  }, [sizing, containerSize]);

  return { scale, containerSize };
}
