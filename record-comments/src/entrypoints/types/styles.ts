import type { CSSProperties } from 'react';

/**
 * Extends React.CSSProperties to include CSS custom properties (variables).
 *
 * TypeScript's CSSProperties type doesn't include CSS custom properties (--*),
 * so this type allows setting them without type assertions.
 *
 * @example
 * const style: StyleWithCustomProps = {
 *   '--accent-color': '#1264a3',
 *   display: 'flex',
 * };
 */
export type StyleWithCustomProps = CSSProperties & Record<`--${string}`, string>;
