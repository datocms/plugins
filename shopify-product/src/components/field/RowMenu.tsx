import { Dropdown } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  ArrowDownIcon,
  ArrowRightArrowLeftIcon,
  ArrowUpIcon,
  ArrowUpRightFromSquareIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from '../../icons';
import { BUSY_REASON } from './useEditorActions';
import { isFocusLost, ROW_FOCUS_ATTRIBUTE } from './useFieldFeedback';

type Props = {
  /** Names the row in the trigger's accessible name. */
  title: string;
  /** The row's position, and how many rows there are. */
  index: number;
  count: number;
  adminUrl: string | null;
  /** For entries saved without an ID: search the admin for the handle. */
  adminSearchUrl: string | null;
  storefrontUrl: string | null;
  /** Read-only field: only the links. */
  readOnly: boolean;
  /** An action runs: the changes wait for it (the links don't). */
  busy: boolean;
  /** A multiple field with several rows: "Move up" and "Move down". */
  reorderable: boolean;
  /** "Replace" is already the row's fix action (unresolved rows). */
  replaceInRow: boolean;
  onReplace: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

type Option = {
  key: string;
  label: string;
  icon: ReactNode;
  alert?: boolean;
} & ({ href: string; onPick?: never } | { onPick: () => void; href?: never });

/** The options in groups: links, changes to the row, then Remove (last). */
function optionGroups(props: Props): Option[][] {
  const links: Option[] = [];
  if (props.adminUrl) {
    links.push({
      key: 'admin',
      label: 'Open in Shopify admin',
      icon: <ArrowUpRightFromSquareIcon />,
      href: props.adminUrl,
    });
  } else if (props.adminSearchUrl) {
    links.push({
      key: 'admin',
      label: 'Search in Shopify admin',
      icon: <MagnifyingGlassIcon />,
      href: props.adminSearchUrl,
    });
  }
  if (props.storefrontUrl) {
    links.push({
      key: 'store',
      label: 'View on store',
      icon: <EyeIcon />,
      href: props.storefrontUrl,
    });
  }
  if (props.readOnly) return [links];

  const changes: Option[] = [];
  if (!props.replaceInRow) {
    changes.push({
      key: 'replace',
      label: 'Replace',
      icon: <ArrowRightArrowLeftIcon />,
      onPick: props.onReplace,
    });
  }
  if (props.reorderable && props.index > 0) {
    changes.push({
      key: 'up',
      label: 'Move up',
      icon: <ArrowUpIcon />,
      onPick: props.onMoveUp,
    });
  }
  if (props.reorderable && props.index < props.count - 1) {
    changes.push({
      key: 'down',
      label: 'Move down',
      icon: <ArrowDownIcon />,
      onPick: props.onMoveDown,
    });
  }
  const remove: Option = {
    key: 'remove',
    label: 'Remove',
    icon: <TrashIcon />,
    alert: true,
    onPick: props.onRemove,
  };
  return [links, changes, [remove]];
}

function triggerOf(wrapper: HTMLElement | null): HTMLElement | null {
  return wrapper?.querySelector<HTMLElement>('[aria-haspopup]') ?? null;
}

/** `Dropdown.Menu`'s default distance from its trigger, in pixels. */
const MENU_OFFSET = 4;
/** The room the kit's menu keeps from the edge of the frame, in pixels. */
const MENU_EDGE_ROOM = 30;

/** The height the menu needs to show every option without scrolling. */
function menuContentHeight(menu: HTMLElement): number {
  const panel = menu.querySelector<HTMLElement>('[role="menu"]') ?? menu;
  return panel.scrollHeight + (panel.offsetHeight - panel.clientHeight);
}

/** The open menu the frame keeps room for (one menu is open at a time). */
let roomHolder: HTMLElement | null = null;

/**
 * The field's frame is only as tall as its rows, and the kit fits a menu in
 * the frame (it scrolls inside, or flips up). While a row's menu is open,
 * the frame keeps room for all of it under the trigger: the auto-resizer
 * grows the frame, and the menu takes the room. The kit adds the menu's
 * portal to the page after its ref is set, so it is measured right after.
 */
function holdRoom(menu: HTMLElement, anchor: HTMLElement | null): void {
  queueMicrotask(() => {
    if (!anchor || !menu.isConnected) return;
    const root = document.documentElement;
    root.style.minHeight = '';
    roomHolder = menu;
    const needed =
      anchor.getBoundingClientRect().bottom +
      window.scrollY +
      MENU_OFFSET +
      menuContentHeight(menu) +
      MENU_EDGE_ROOM;
    if (needed > root.getBoundingClientRect().height) {
      root.style.minHeight = `${Math.ceil(needed)}px`;
    }
  });
}

/** The menu closed: the frame can shrink back to its rows. */
function releaseRoom(menu: HTMLElement): void {
  if (roomHolder !== menu) return;
  roomHolder = null;
  document.documentElement.style.minHeight = '';
}

type OpenMenu = {
  element: HTMLElement;
  /** A link option was picked: the kit closes the menu without refocusing. */
  linkPicked: boolean;
  onClick: (event: MouseEvent) => void;
};

/**
 * The ref of the row's menu, set while it is open: it keeps room for the
 * menu in the frame (`holdRoom`). A link option closes the menu without
 * giving focus back, so the trigger takes it when the menu leaves, instead
 * of the page.
 */
function useMenuElement(trigger: () => HTMLElement | null) {
  const open = useRef<OpenMenu | null>(null);
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;

  return useCallback((element: HTMLDivElement | null) => {
    const previous = open.current;
    open.current = null;
    if (previous) {
      previous.element.removeEventListener('click', previous.onClick, true);
      releaseRoom(previous.element);
      const active = document.activeElement;
      const focusLeaves =
        isFocusLost() ||
        (active instanceof Node && previous.element.contains(active));
      if (previous.linkPicked && focusLeaves) {
        triggerRef.current()?.focus({ preventScroll: true });
      }
    }
    if (!element) return;

    const current: OpenMenu = {
      element,
      linkPicked: false,
      onClick: (event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('a[href]')
        ) {
          current.linkPicked = true;
        }
      },
    };
    element.addEventListener('click', current.onClick, true);
    holdRoom(element, triggerRef.current());
    open.current = current;
  }, []);
}

/**
 * The "⋮" of a row. A pick gives focus back to the trigger first, as a
 * native menu does (the kit's menu keeps it while it fades out, then drops
 * it to the page): the focus rescue then finds where the row went. "Move up"
 * and "Move down" move the row in the DOM, which drops its focus, so the
 * trigger takes it back once the row is in its new place.
 *
 * While an action runs, the trigger stays enabled and its changes are
 * disabled with the reason: a trigger disabled with a reason is another
 * element in the kit, so toggling it would drop the focus of every row.
 */
export default function RowMenu(props: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const followMove = useRef(false);
  const menuRef = useMenuElement(() => triggerOf(wrapper.current));
  const groups = optionGroups(props).filter((group) => group.length > 0);
  const total = groups.reduce((sum, group) => sum + group.length, 0);

  // Runs after the DOM move, before the browser paints.
  const placedAt = useRef(props.index);
  useLayoutEffect(() => {
    if (placedAt.current === props.index) return;
    placedAt.current = props.index;
    if (followMove.current && isFocusLost()) {
      triggerOf(wrapper.current)?.focus({ preventScroll: true });
    }
  }, [props.index]);

  // A failed write moves the row back while the action still runs.
  useEffect(() => {
    if (!props.busy) followMove.current = false;
  }, [props.busy]);

  if (total === 0) return null;

  const pick = (option: Option & { onPick: () => void }) => () => {
    triggerOf(wrapper.current)?.focus({ preventScroll: true });
    followMove.current = option.key === 'up' || option.key === 'down';
    option.onPick();
  };

  // A menu with one option has no icon.
  const iconOf = (option: Option) => (total > 1 ? option.icon : undefined);

  return (
    <div ref={wrapper} {...{ [ROW_FOCUS_ATTRIBUTE]: '' }}>
      <Dropdown
        triggerComponent={IconTrigger}
        icon={EllipsisVerticalIcon}
        label={`Actions for ${props.title}`}
      >
        <Dropdown.Menu ref={menuRef} placement="bottom-end">
          {groups.map((group, position) => (
            <OptionGroup
              key={group[0]?.key}
              options={group}
              separated={position > 0}
              iconOf={iconOf}
              pick={pick}
              busy={props.busy}
            />
          ))}
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
}

function OptionGroup({
  options,
  separated,
  iconOf,
  pick,
  busy,
}: {
  options: Option[];
  separated: boolean;
  iconOf: (option: Option) => ReactNode;
  pick: (option: Option & { onPick: () => void }) => () => void;
  busy: boolean;
}) {
  return (
    <>
      {separated && <Dropdown.Separator />}
      {options.map((option) =>
        option.href !== undefined ? (
          <Dropdown.Option
            key={option.key}
            icon={iconOf(option)}
            href={option.href}
            newTab
          >
            {option.label}
          </Dropdown.Option>
        ) : (
          <Dropdown.Option
            key={option.key}
            icon={iconOf(option)}
            alert={option.alert}
            disabled={busy ? { reason: BUSY_REASON } : undefined}
            onPick={pick(option)}
          >
            {option.label}
          </Dropdown.Option>
        ),
      )}
    </>
  );
}
