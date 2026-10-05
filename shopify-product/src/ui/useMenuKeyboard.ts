import { type MouseEvent, useCallback, useEffect, useRef } from 'react';

/**
 * Keyboard support and menu semantics for a kit `Dropdown`, which portals its
 * options to the end of the document, renders them as plain buttons, and only
 * handles keys inside its search field (shown with more than 5 options). Use
 * it through `<Menu>` (ui/Menu.tsx), which wires the ids below.
 *
 * - Opening from the keyboard focuses the search field when there is one,
 *   else the first enabled option. A mouse opening leaves focus on the
 *   trigger, so no row looks hovered; Down then enters the menu.
 * - Up and Down move through the search field and the enabled options
 *   (wrapping); Home and End jump to the first and last option. Typing on an
 *   option moves to the search field.
 * - Esc closes and returns focus to the trigger, from anywhere; Tab closes
 *   and continues from the trigger.
 * - Picking an option (the menu unmounts) returns focus to the trigger.
 * - While open, the option list is a `role="menu"` labelled by the trigger,
 *   options are `menuitem`s (`menuitemradio` or `menuitemcheckbox` with
 *   `aria-checked` in selection menus), and disabled options carry
 *   `aria-disabled` and are skipped: the kit's `disabled` only adds a class.
 */

/**
 * - `none`: actions (the default).
 * - `single`: options pick one current value (`active` marks it).
 * - `multiple`: options toggle (`active` marks the checked ones).
 */
export type MenuSelection = 'none' | 'single' | 'multiple';

export type MenuTriggerProps = {
  id: string;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: (event: MouseEvent<HTMLElement>) => void;
};

export type MenuIds = { trigger: string; anchor: string; menu: string };

export function menuIds(menuId: string): MenuIds {
  return {
    trigger: `${menuId}trigger`,
    anchor: `${menuId}anchor`,
    menu: `${menuId}menu`,
  };
}

/** Marks an option as a plain action inside a selection menu. */
export const MENU_ACTION_ATTRIBUTE = 'data-menu-action';

// The kit's CSS-module class names keep their source names.
const LIST_SELECTOR = '[class*="_Dropdown__menu__inner_"]';
const OPTION_SELECTOR = 'button[class*="_Dropdown__menu__option__content_"]';
const SEARCH_SELECTOR = 'input[class*="_Dropdown__menu__search__input_"]';
const GROUP_TITLE_SELECTOR = '[class*="_Dropdown__menu__group__title_"]';
const SEPARATOR_SELECTOR = '[class*="_Dropdown__menu__separator_"]';
const DISABLED_CLASS = '_Dropdown__menu__option--is-disabled_';
const ACTIVE_CLASS = '_Dropdown__menu__option--is-active_';

type MenuParts = {
  /** The kit's menu box: search field plus list. */
  box: HTMLElement;
  list: HTMLElement;
  search: HTMLInputElement | null;
  /** Enabled options, in order. */
  options: HTMLButtonElement[];
};

function setAttribute(element: Element, name: string, value: string | null) {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function hasClass(element: Element | null, fragment: string): boolean {
  return Boolean(element?.className.includes(fragment));
}

function optionRole(option: HTMLButtonElement, selection: MenuSelection) {
  if (
    selection === 'none' ||
    option.querySelector(`[${MENU_ACTION_ATTRIBUTE}]`)
  ) {
    return 'menuitem';
  }
  return selection === 'single' ? 'menuitemradio' : 'menuitemcheckbox';
}

function decorateOption(option: HTMLButtonElement, selection: MenuSelection) {
  const wrapper = option.parentElement;
  const role = optionRole(option, selection);
  setAttribute(option, 'role', role);
  setAttribute(option, 'tabindex', '-1');
  setAttribute(
    option,
    'aria-checked',
    role === 'menuitem' ? null : String(hasClass(wrapper, ACTIVE_CLASS)),
  );
  setAttribute(
    option,
    'aria-disabled',
    hasClass(wrapper, DISABLED_CLASS) ? 'true' : null,
  );
}

function decorateStructure(list: HTMLElement) {
  for (const title of list.querySelectorAll(GROUP_TITLE_SELECTOR)) {
    const group = title.parentElement;
    if (!group) continue;
    setAttribute(group, 'role', 'group');
    setAttribute(group, 'aria-label', title.textContent?.trim() ?? null);
    setAttribute(title, 'aria-hidden', 'true');
  }
  for (const separator of list.querySelectorAll(SEPARATOR_SELECTOR)) {
    setAttribute(separator, 'role', 'separator');
  }
}

/** Finds the open menu and (re)applies the menu semantics. */
function readMenu(ids: MenuIds, selection: MenuSelection): MenuParts | null {
  const list = document.getElementById(ids.anchor)?.closest(LIST_SELECTOR);
  const box = list?.parentElement;
  if (!(list instanceof HTMLElement) || !box) return null;

  setAttribute(list, 'id', ids.menu);
  setAttribute(list, 'role', 'menu');
  setAttribute(list, 'aria-labelledby', ids.trigger);
  decorateStructure(list);

  const options: HTMLButtonElement[] = [];
  for (const option of list.querySelectorAll<HTMLButtonElement>(
    OPTION_SELECTOR,
  )) {
    decorateOption(option, selection);
    if (!option.hasAttribute('aria-disabled')) options.push(option);
  }
  const search = box.querySelector<HTMLInputElement>(SEARCH_SELECTOR);
  if (search) setAttribute(search, 'aria-controls', ids.menu);
  return { box, list, search, options };
}

/** The search field (when there is one), then the enabled options. */
function stops(menu: MenuParts): HTMLElement[] {
  return menu.search ? [menu.search, ...menu.options] : menu.options;
}

function focusInitial(menu: MenuParts) {
  (menu.search ?? menu.options[0])?.focus();
}

const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

function isTypingKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 &&
    event.key !== ' ' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

/** From the trigger: Down and Home enter at the top, Up and End at the end. */
function enterMenu(event: KeyboardEvent, menu: MenuParts) {
  const targets = stops(menu);
  if (targets.length === 0) return;
  event.preventDefault();
  const last = event.key === 'ArrowUp' || event.key === 'End';
  targets[last ? targets.length - 1 : 0]?.focus();
}

/** In the search field, Up and Down leave for the options; the rest types. */
function navigateFromSearch(event: KeyboardEvent, menu: MenuParts) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  // Keep the kit's own highlight-only navigation out of it.
  event.preventDefault();
  event.stopPropagation();
  const { options } = menu;
  options[event.key === 'ArrowDown' ? 0 : options.length - 1]?.focus();
}

function navigateFromOption(
  event: KeyboardEvent,
  menu: MenuParts,
  option: HTMLButtonElement,
) {
  if (isTypingKey(event)) {
    // The key's character lands in the newly focused field.
    menu.search?.focus();
    return;
  }
  if (!NAVIGATION_KEYS.has(event.key)) return;
  event.preventDefault();
  const { options } = menu;
  if (event.key === 'Home' || event.key === 'End') {
    options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    return;
  }
  const targets = stops(menu);
  const delta = event.key === 'ArrowUp' ? -1 : 1;
  const index = targets.indexOf(option);
  if (index === -1) {
    // A disabled option kept focus (it turned disabled, or was clicked).
    options[delta > 0 ? 0 : options.length - 1]?.focus();
    return;
  }
  targets[(index + delta + targets.length) % targets.length]?.focus();
}

type MenuActions = {
  ids: MenuIds;
  selection: MenuSelection;
  close: () => void;
  closeToTrigger: () => void;
};

function handleMenuKey(event: KeyboardEvent, actions: MenuActions) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    actions.closeToTrigger();
    return;
  }
  const menu = readMenu(actions.ids, actions.selection);
  if (!menu) return;
  const active = document.activeElement;
  const insideMenu = active instanceof Node && menu.box.contains(active);

  if (event.key === 'Tab') {
    // No preventDefault: Tab then moves on from the trigger.
    if (insideMenu) actions.closeToTrigger();
    else actions.close();
    return;
  }
  if (active === menu.search) {
    navigateFromSearch(event, menu);
  } else if (
    active instanceof HTMLButtonElement &&
    menu.list.contains(active)
  ) {
    navigateFromOption(event, menu, active);
  } else if (active?.id === actions.ids.trigger) {
    if (NAVIGATION_KEYS.has(event.key)) enterMenu(event, menu);
  }
}

export function useMenuKeyboard({
  open,
  toggle,
  menuId,
  selection = 'none',
}: {
  open: boolean;
  /** The kit's `onClick` from `renderTrigger`, which toggles the menu. */
  toggle: () => void;
  /** From `useId()`, shared with the menu's anchor (see ui/Menu.tsx). */
  menuId: string;
  selection?: MenuSelection;
}): MenuTriggerProps {
  const ids = menuIds(menuId);
  const openedWithKeyboard = useRef(false);
  const wasOpen = useRef(false);
  const isOpen = useRef(open);
  isOpen.current = open;

  const close = useCallback(() => {
    if (isOpen.current) toggle();
  }, [toggle]);

  useEffect(() => {
    if (!open) return undefined;
    wasOpen.current = true;
    const menuIdsNow = menuIds(menuId);
    const actions: MenuActions = {
      ids: menuIdsNow,
      selection,
      close,
      closeToTrigger: () => {
        close();
        document.getElementById(menuIdsNow.trigger)?.focus();
      },
    };
    let observer: MutationObserver | null = null;
    // The kit's portal attaches to the document in an effect of its own,
    // which runs after this one.
    const timeout = window.setTimeout(() => {
      const menu = readMenu(menuIdsNow, selection);
      if (!menu) return;
      // Options load, filter and change state while the menu is open.
      observer = new MutationObserver(() => readMenu(menuIdsNow, selection));
      observer.observe(menu.box, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      if (openedWithKeyboard.current) focusInitial(menu);
    });
    function onKeyDown(event: KeyboardEvent) {
      handleMenuKey(event, actions);
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(timeout);
      observer?.disconnect();
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close, menuId, selection]);

  // Focus was on an option that just unmounted: give it back to the trigger.
  useEffect(() => {
    if (open || !wasOpen.current) return undefined;
    wasOpen.current = false;
    const triggerId = menuIds(menuId).trigger;
    const timeout = window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) {
        document.getElementById(triggerId)?.focus({ preventScroll: true });
      }
    });
    return () => window.clearTimeout(timeout);
  }, [open, menuId]);

  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      // Enter and Space fire a click with no pointer detail.
      openedWithKeyboard.current = event.detail === 0;
      toggle();
    },
    [toggle],
  );

  return {
    id: ids.trigger,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? ids.menu : undefined,
    onClick,
  };
}
