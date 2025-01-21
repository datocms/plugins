import type { Viewport } from '../types/viewport';
import type { CSSProperties } from 'react';

export function computeIframeStyles(viewport: Viewport, scale: number): CSSProperties {
  const baseStyles: CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transformOrigin: 'center center',
    transition: 'width 0.3s ease, height 0.3s ease, transform 0.3s ease',
  };

  if (viewport.isFitToSidebar) {
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
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
    transform: `translate(-50%, -50%) scale(${scale})`,
  };
} 