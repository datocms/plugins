import { type RefObject, useCallback, useRef } from 'react';

/** The open menu that the frame keeps room for (one is open at a time) */
let roomHolder: HTMLElement | null = null;

/**
 * The frame is only as tall as the table, and the kit fits an open menu
 * inside the frame, so in a short table a column or row menu would scroll in
 * a sliver. While a menu is open, the frame keeps room for all of it under
 * its trigger (4px away, plus the 30px the kit keeps from the edge): the
 * auto-resizer grows the frame, and shrinks it back once the menu closes.
 * The kit fills the menu's portal right after setting its ref.
 */
export function useMenuRoom(anchor: RefObject<HTMLElement | null>) {
  const openMenu = useRef<HTMLElement | null>(null);

  return useCallback(
    (menu: HTMLDivElement | null) => {
      const root = document.documentElement;
      if (openMenu.current && roomHolder === openMenu.current) {
        roomHolder = null;
        root.style.minHeight = '';
      }
      openMenu.current = menu;
      if (!menu) return;

      queueMicrotask(() => {
        if (!anchor.current || !menu.isConnected) return;
        const panel = menu.querySelector('[role="menu"]') ?? menu;
        const bottom = anchor.current.getBoundingClientRect().bottom;
        roomHolder = menu;
        root.style.minHeight = `${Math.ceil(
          bottom + window.scrollY + 4 + panel.scrollHeight + 30,
        )}px`;
      });
    },
    [anchor],
  );
}
