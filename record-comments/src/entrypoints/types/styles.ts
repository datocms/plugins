import type { CSSProperties } from 'react';

// Extends CSSProperties to allow CSS custom properties (--*) without type assertions
export type StyleWithCustomProps = CSSProperties & Record<`--${string}`, string>;
