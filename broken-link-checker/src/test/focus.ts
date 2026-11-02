import { vi } from 'vitest';

/**
 * jsdom never matches `:focus-visible`, which only a keyboard user's focus
 * does. From here on, the focused element matches it.
 */
export function focusFromKeyboard() {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
    this: Element,
    selectors: string,
  ) {
    if (selectors === ':focus-visible') return this === document.activeElement;
    return matches.call(this, selectors);
  });
}
