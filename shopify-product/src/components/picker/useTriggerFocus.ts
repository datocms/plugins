import { useCallback, useRef } from 'react';

/**
 * A kit menu gives focus back to its trigger on Escape and Tab, but not when
 * an option is picked: focus stays on the fading menu, then drops to the
 * page. The picker's menus hand it back, as a native menu does. Put `ref` on
 * an element around the Dropdown and call `refocus()` when a pick (or the
 * menu's small form) applies its value. A pick by Enter is safe: the menu
 * stops that keydown, so it never reaches the trigger.
 */
export function useTriggerFocus() {
  const ref = useRef<HTMLDivElement>(null);
  const refocus = useCallback(() => {
    ref.current
      ?.querySelector<HTMLElement>('[aria-haspopup]')
      ?.focus({ preventScroll: true });
  }, []);
  return { ref, refocus };
}
