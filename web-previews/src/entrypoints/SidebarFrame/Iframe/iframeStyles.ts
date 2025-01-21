import type { CSSProperties } from 'react';
import type { SizingStrategy } from '../Iframe';

export function computeIframeStyles(
  sizing: SizingStrategy,
  scale: number,
): CSSProperties {
  const baseStyles: CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transformOrigin: 'center center',
    transition: 'width 0.3s ease, height 0.3s ease, transform 0.3s ease',
  };

  if (sizing === 'responsive') {
    return {
      ...baseStyles,
      width: '100%',
      height: '100%',
      maxWidth: '100%',
      maxHeight: '100%',
      transform: 'translate(-50%, -50%)',
    };
  }

  return {
    ...baseStyles,
    width: `${sizing.width}px`,
    height: `${sizing.height}px`,
    transform: `translate(-50%, -50%) scale(${scale})`,
  };
}
