import { type ChangeEvent } from 'react';
import { type Viewport, MIN_VIEWPORT_DIMENSION, MAX_VIEWPORT_DIMENSION } from '../../types/viewport';
import styles from './styles.module.css';

interface ViewportCustomizerProps {
  viewport: Viewport;
  onDimensionChange: (dimension: number, type: 'width' | 'height') => void;
}

export function ViewportCustomizer({ viewport, onDimensionChange }: ViewportCustomizerProps) {
  const handleDimensionChange = (e: ChangeEvent<HTMLInputElement>, type: 'width' | 'height') => {
    const rawValue = e.target.value.replace(/\D/g, '');
    const numericValue = Number.parseInt(rawValue) || 0;
    
    // Clamp value between min and max dimensions
    const clampedValue = Math.min(
      Math.max(numericValue, MIN_VIEWPORT_DIMENSION),
      MAX_VIEWPORT_DIMENSION,
    );
    
    onDimensionChange(clampedValue, type);
  };

  return (
    <div className={styles.customViewportPill}>
      <input
        type="text"
        value={viewport.width}
        onChange={(e) => handleDimensionChange(e, 'width')}
        placeholder="Width"
        className={styles.dimensionInput}
        aria-label="Viewport width"
      />
      <span>×</span>
      <input
        type="text"
        value={viewport.height}
        onChange={(e) => handleDimensionChange(e, 'height')}
        placeholder="Height"
        className={styles.dimensionInput}
        aria-label="Viewport height"
      />
    </div>
  );
} 