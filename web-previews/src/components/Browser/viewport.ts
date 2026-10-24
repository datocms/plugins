import { useState } from 'react';
import type { Viewport } from '../../types';

/** A size of the preview, in pixels */
export type ViewportSize = { width: number; height: number };

/**
 * What the preview shows: the page fitted to the free space ('responsive'),
 * a preset of the plugin settings, or the size that the user types
 * ('custom')
 */
export type ViewportChoice = Viewport | 'responsive' | 'custom';

/** How the iframe gets its size: it fills the free space, or a fixed size */
export type ViewportSizing = ViewportSize | 'responsive';

/** The size that "Custom size" starts from */
export const DEFAULT_CUSTOM_SIZE: ViewportSize = { width: 800, height: 600 };

export function sizingOf(
  choice: ViewportChoice,
  customSize: ViewportSize,
): ViewportSizing {
  if (choice === 'responsive') {
    return 'responsive';
  }

  if (choice === 'custom') {
    return customSize;
  }

  return choice;
}

/** The presets are told apart by their name, as in the plugin settings */
export function isSameChoice(a: ViewportChoice, b: ViewportChoice): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }

  return a.name === b.name;
}

/**
 * The number that the user types in a size field: the characters that are
 * not digits go away, and an empty field is 0
 */
export function parseDimension(value: string | null): number {
  const digits = (value ?? '').replace(/\D/g, '');

  return Number.parseInt(digits, 10) || 0;
}

export type ViewportState = ReturnType<typeof useViewport>;

/**
 * The viewport of a preview, for this session: it starts fitted to the free
 * space, and the custom size keeps its value while the user picks presets.
 */
export function useViewport() {
  const [choice, setChoice] = useState<ViewportChoice>('responsive');
  const [customSize, setCustomSize] =
    useState<ViewportSize>(DEFAULT_CUSTOM_SIZE);

  return {
    choice,
    setChoice,
    customSize,
    setCustomSize,
    sizing: sizingOf(choice, customSize),
  };
}
