import {
  CaretDownIcon,
  CaretUpIcon,
  Dropdown,
  DropdownMenu,
  DropdownOption,
  DropdownSeparator,
} from 'datocms-react-ui';
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { Button } from '../../ui/Button';
import type { ModelFilterView } from '../contract';
import { type Copy, STRINGS } from './copy';

type ModelFilterProps = {
  view: ModelFilterView;
  copy: Copy;
  onChange: (modelId: string | null) => void;
};

const TRIGGER_CLASS = 'fr-filter__trigger';

function OptionLabel({
  menuId,
  active,
  name,
  count,
  partial,
  copy,
}: {
  menuId: string;
  active: boolean;
  name: string;
  count: number | null;
  partial: boolean;
  copy: Copy;
}) {
  return (
    <span
      className="fr-option"
      data-filter-menu={menuId}
      data-filter-active={active ? 'true' : undefined}
    >
      <span>{name}</span>
      <span className="fr-option__count" aria-hidden="true">
        {copy.optionCount(count, partial)}
      </span>
      <span className="fr-sr-only">{copy.optionCountSuffix(count)}</span>
    </span>
  );
}

/** The open menu, reached through the DOM: the kit portals it to the end of <body> and gives no refs. */
type MenuDom = {
  trigger: () => HTMLButtonElement | null;
  /** The option buttons, in order ("All models" first). */
  options: () => HTMLButtonElement[];
  /** The kit's "Search..." input (only above 5 options). */
  search: () => HTMLInputElement | null;
  /** The option the menu opens on: the chosen model's, else the first. */
  active: () => HTMLButtonElement | null;
};

function useMenuDom(
  rootRef: RefObject<HTMLDivElement | null>,
  menuId: string,
): MenuDom {
  return useMemo(() => {
    const trigger = () =>
      rootRef.current?.querySelector<HTMLButtonElement>(`.${TRIGGER_CLASS}`) ??
      null;
    const labels = () => {
      const all =
        rootRef.current?.ownerDocument.querySelectorAll<HTMLElement>(
          '[data-filter-menu]',
        ) ?? [];
      return Array.from(all).filter(
        (label) => label.dataset.filterMenu === menuId,
      );
    };
    const options = () => {
      const buttons: HTMLButtonElement[] = [];
      for (const label of labels()) {
        const button = label.closest('button');
        if (button) {
          buttons.push(button);
        }
      }
      return buttons;
    };
    const search = () => {
      // Walk up from an option to the portal root (a child of <body>): the only input in there.
      let node: HTMLElement | null = options()[0] ?? null;
      while (node?.parentElement && node.parentElement.tagName !== 'BODY') {
        node = node.parentElement;
      }
      return node?.querySelector('input') ?? null;
    };
    const active = () =>
      labels()
        .find((label) => label.dataset.filterActive === 'true')
        ?.closest('button') ??
      options()[0] ??
      null;
    return { trigger, options, search, active };
  }, [rootRef, menuId]);
}

/** Focus an element of the menu once the kit has positioned it (it stays hidden until then). */
function focusSoon(target: () => HTMLElement | null, tries = 10): void {
  const element = target();
  element?.focus();
  if (
    tries > 0 &&
    (!element || element.ownerDocument.activeElement !== element)
  ) {
    window.requestAnimationFrame(() => focusSoon(target, tries - 1));
  }
}

/** A character to type into the search (Space stays with the button: it picks the option). */
function isTypedCharacter(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 &&
    event.key !== ' ' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

/** Roving focus over the option buttons: the one `key` moves to, or null for other keys. */
function nextOption(
  key: string,
  options: HTMLButtonElement[],
  current: Element | null,
): HTMLButtonElement | null {
  const last = options.length - 1;
  const index =
    current instanceof HTMLButtonElement ? options.indexOf(current) : -1;
  switch (key) {
    case 'ArrowDown':
      return options[index < 0 || index === last ? 0 : index + 1] ?? null;
    case 'ArrowUp':
      return options[index <= 0 ? last : index - 1] ?? null;
    case 'Home':
      return options[0] ?? null;
    case 'End':
      return options[last] ?? null;
    default:
      return null;
  }
}

type MenuControl = { open: boolean; toggle: () => void };

/**
 * Keys while the menu is open (the kit handles them only in its search input,
 * above 5 options, and even there Enter can pick the wrong option): arrows,
 * Home and End move between options, Enter or Space picks the focused one,
 * Esc closes and returns to the trigger, Tab closes and moves on from the
 * trigger, and typing goes to the search input when there is one.
 */
function handleOpenMenuKey(
  event: KeyboardEvent<HTMLDivElement>,
  dom: MenuDom,
  close: () => void,
): void {
  const search = dom.search();
  const options = dom.options();
  const focused = event.target instanceof Element ? event.target : null;
  const inSearch = search !== null && focused === search;
  const stop = () => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (event.key === 'Escape') {
    stop();
    close();
    return;
  }
  if (event.key === 'Tab') {
    // Leave from the trigger, so Tab goes on to the control after it (not to the end of the page).
    close();
    return;
  }
  if (inSearch && event.key === 'Enter') {
    stop();
    options[0]?.click();
    return;
  }
  if (inSearch && (event.key === 'Home' || event.key === 'End')) {
    return;
  }
  const target = nextOption(event.key, options, focused);
  if (target) {
    stop();
    target.focus();
    return;
  }
  const onOption = options.some((option) => option === focused);
  if (search && onOption && isTypedCharacter(event)) {
    search.focus();
  }
}

/** The trigger, with the state the kit keeps to itself mirrored to the DOM and the parent. */
function Trigger({
  open,
  toggle,
  disabled,
  label,
  control,
  dom,
  onToggle,
}: {
  open: boolean;
  toggle: () => void;
  disabled: boolean;
  label: string;
  control: RefObject<MenuControl>;
  dom: MenuDom;
  onToggle: (opening: boolean) => void;
}) {
  useLayoutEffect(() => {
    control.current = { open, toggle };
  });
  // The kit Button takes no aria props: expose the disclosure state on the element itself
  // (after the commit, once the parent's ref points at the rendered row).
  useEffect(() => {
    dom.trigger()?.setAttribute('aria-expanded', String(open));
  });

  return (
    <Button
      className={TRIGGER_CLASS}
      buttonSize="xs"
      disabled={disabled}
      onClick={() => onToggle(!open)}
      rightIcon={open ? <CaretUpIcon /> : <CaretDownIcon />}
    >
      {label}
    </Button>
  );
}

/**
 * "All models ▾": a view over the results (never re-scans). Records it hides
 * aren't shown, counted or written. Keyboard: Enter, Space or ↓ opens it on
 * the chosen option (or in the search input above 5 options); see
 * `handleOpenMenuKey` for the rest. A run disables it and closes the menu.
 */
export function ModelFilter({ view, copy, onChange }: ModelFilterProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const control = useRef<MenuControl>({ open: false, toggle: () => {} });
  const dom = useMenuDom(rootRef, menuId);

  const close = useCallback(() => {
    if (control.current.open) {
      control.current.toggle();
    }
    dom.trigger()?.focus();
  }, [dom]);

  const onToggle = useCallback(
    (opening: boolean) => {
      control.current.toggle();
      if (opening) {
        focusSoon(() => dom.search() ?? dom.active());
      }
    },
    [dom],
  );

  const choose = (modelId: string | null) => {
    onChange(modelId);
    // The kit closes the menu; the focus goes back to the trigger, not to <body>.
    dom.trigger()?.focus();
  };

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (control.current.open) {
      handleOpenMenuKey(event, dom, close);
      return;
    }
    const onTrigger = event.target === dom.trigger();
    if (onTrigger && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      onToggle(true);
    }
  };

  return (
    // The capture handler sees the menu's keys too: React events follow the tree through the portal.
    <div
      ref={rootRef}
      className="fr-filter"
      onKeyDownCapture={onKeyDownCapture}
    >
      <Dropdown
        // Remounted when a run disables it, so an open menu closes with it.
        key={view.enabled ? 'enabled' : 'disabled'}
        renderTrigger={({ open, onClick }) => (
          <Trigger
            open={open}
            toggle={onClick}
            disabled={!view.enabled}
            label={copy.filterTrigger(view.selected)}
            control={control}
            dom={dom}
            onToggle={onToggle}
          />
        )}
      >
        <DropdownMenu alignment="right">
          <DropdownOption
            active={view.selected === null}
            onClick={() => choose(null)}
          >
            <OptionLabel
              menuId={menuId}
              active={view.selected === null}
              name={STRINGS.allModels}
              count={view.allMatchCount}
              partial={view.partial}
              copy={copy}
            />
          </DropdownOption>
          <DropdownSeparator />
          {view.options.map((option) => (
            <DropdownOption
              key={option.id}
              active={view.selected?.id === option.id}
              onClick={() => choose(option.id)}
            >
              <OptionLabel
                menuId={menuId}
                active={view.selected?.id === option.id}
                name={option.name}
                count={option.matchCount}
                partial={view.partial}
                copy={copy}
              />
            </DropdownOption>
          ))}
        </DropdownMenu>
      </Dropdown>
    </div>
  );
}
