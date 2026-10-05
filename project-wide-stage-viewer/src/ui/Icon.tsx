import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import { memo } from 'react';

type IconProps = {
  icon: IconDefinition;
  className?: string;
  /** Accessible name. Omit it when a text label sits next to the icon. */
  title?: string;
};

/**
 * A Font Awesome 6 glyph as a 1em square SVG whose fill comes from CSS
 * (`.dl-icon` in kit-fixes.css, ink-subtle at rest).
 */
export const Icon = memo(function Icon({ icon, className, title }: IconProps) {
  const [width, height, , , pathData] = icon.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  return (
    <svg
      className={className ? `dl-icon ${className}` : 'dl-icon'}
      viewBox={`0 0 ${width} ${height}`}
      width="1em"
      height="1em"
      focusable="false"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
});
