import {
  createContext,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from 'react';
import { gridColumnCount } from './useGridColumns';

/**
 * Roving tabindex across the results: one item is the tab stop, arrow keys
 * move between items. Items carry `data-roving="<unique key>"`; each grid or
 * list that lays them out carries `data-roving-grid`, so Up and Down can
 * jump by its column count. A variant panel's grid also carries
 * `data-roving-owner="<owner key>"`, and its owner card `aria-controls`.
 */

const ITEM = '[data-roving]';
const GRID = '[data-roving-grid]';

export type RovingState = {
  activeKey: string | null;
};

export const RovingContext = createContext<RovingState>({ activeKey: null });

/** `tabIndex` for an item: 0 for the tab stop, -1 for the rest. */
export function useRovingTabIndex(key: string): 0 | -1 {
  return useContext(RovingContext).activeKey === key ? 0 : -1;
}

function itemsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ITEM));
}

function gridOf(item: HTMLElement): HTMLElement | null {
  return item.closest<HTMLElement>(GRID);
}

/**
 * The items of the first grid in `container`, without the rows of a variant
 * panel opened inside it.
 */
export function gridItems(container: HTMLElement | null): HTMLElement[] {
  const grid = container?.querySelector<HTMLElement>(GRID);
  if (!grid) return [];
  return itemsIn(grid).filter((item) => gridOf(item) === grid);
}

function panelEntry(item: HTMLElement, root: HTMLElement): HTMLElement | null {
  if (item.getAttribute('aria-expanded') !== 'true') return null;
  const panelId = item.getAttribute('aria-controls');
  const panel = panelId ? root.ownerDocument.getElementById(panelId) : null;
  return panel?.querySelector<HTMLElement>(ITEM) ?? null;
}

function panelOwner(grid: HTMLElement, root: HTMLElement): HTMLElement | null {
  const owner = grid.dataset.rovingOwner;
  if (!owner) return null;
  return (
    itemsIn(root).find((candidate) => candidate.dataset.roving === owner) ??
    null
  );
}

function verticalTarget(
  root: HTMLElement,
  all: HTMLElement[],
  current: HTMLElement,
  direction: 1 | -1,
): HTMLElement | undefined {
  if (direction === 1) {
    const intoPanel = panelEntry(current, root);
    if (intoPanel) return intoPanel;
  }
  const grid = gridOf(current);
  const siblings = all.filter((item) => gridOf(item) === grid);
  const columns = gridColumnCount(grid);
  const index = siblings.indexOf(current);
  const target = siblings[index + direction * columns];
  if (target) return target;
  if (direction === 1) {
    const lastRow = Math.floor((siblings.length - 1) / columns);
    const last = siblings[siblings.length - 1];
    if (Math.floor(index / columns) < lastRow) return last;
    return last ? all[all.indexOf(last) + 1] : undefined;
  }
  const owner = grid ? panelOwner(grid, root) : null;
  if (owner) return owner;
  const first = siblings[0];
  return first ? all[all.indexOf(first) - 1] : undefined;
}

/** The item an arrow, Home or End key moves to, if any. */
export function nextRovingItem(
  root: HTMLElement,
  current: HTMLElement,
  key: string,
): HTMLElement | undefined {
  const all = itemsIn(root);
  const index = all.indexOf(current);
  if (index === -1) return undefined;
  switch (key) {
    case 'ArrowRight':
      return all[index + 1];
    case 'ArrowLeft':
      return all[index - 1];
    case 'ArrowDown':
      return verticalTarget(root, all, current, 1);
    case 'ArrowUp':
      return verticalTarget(root, all, current, -1);
    case 'Home':
      return all[0];
    case 'End':
      return all[all.length - 1];
    default:
      return undefined;
  }
}

const NAVIGATION_KEYS = new Set([
  'ArrowRight',
  'ArrowLeft',
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
]);

/**
 * Owns the roving state for a results container: keeps exactly one tab stop
 * (the first item until the editor moves), and handles the arrow keys.
 */
export function useRovingFocus(root: RefObject<HTMLElement | null>) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // After every render: if the tab stop disappeared (new results), the first
  // item becomes the tab stop.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const items = itemsIn(element);
    if (items.some((item) => item.dataset.roving === activeKey)) return;
    const first = items[0]?.dataset.roving ?? null;
    if (first !== activeKey) setActiveKey(first);
  });

  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(ITEM);
    const key = item?.dataset.roving;
    if (key) setActiveKey(key);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const element = root.current;
      const target = event.target as HTMLElement;
      if (!element || !NAVIGATION_KEYS.has(event.key) || !target.matches(ITEM))
        return;
      const next = nextRovingItem(element, target, event.key);
      if (!next) return;
      event.preventDefault();
      setActiveKey(next.dataset.roving ?? null);
      next.focus();
      next.scrollIntoView?.({ block: 'nearest' });
    },
    [root],
  );

  return { activeKey, onFocus, onKeyDown };
}
