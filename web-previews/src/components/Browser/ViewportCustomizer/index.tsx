import type { ChangeEvent } from 'react';
import styles from './styles.module.css';

export type ViewportSize = { width: number; height: number };

interface Props {
  size: ViewportSize;
  onChange: (newSize: ViewportSize) => void;
}

export function ViewportCustomizer({ size, onChange }: Props) {
  const handleDimensionChange = (
    e: ChangeEvent<HTMLInputElement>,
    type: 'width' | 'height',
  ) => {
    const rawValue = e.target.value.replace(/\D/g, '');
    const numericValue = Number.parseInt(rawValue) || 0;

    // Clamp value between min and max dimensions
    const clampedValue = Math.max(numericValue, 0);

    onChange({ ...size, [type]: clampedValue });
  };

  return (
    <div className={styles.customViewportPill}>
      <input
        type="text"
        value={size.width}
        onChange={(e) => handleDimensionChange(e, 'width')}
        placeholder="Width"
        className={styles.dimensionInput}
        aria-label="Viewport width"
      />
      <span>×</span>
      <input
        type="text"
        value={size.height}
        onChange={(e) => handleDimensionChange(e, 'height')}
        placeholder="Height"
        className={styles.dimensionInput}
        aria-label="Viewport height"
      />
      <span>px</span>
    </div>
  );
}
