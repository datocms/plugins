import { useClickOutside } from '@hooks/useDropdown';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import NewZIndex from 'datocms-react-ui/NewZIndex';
import Spinner from 'datocms-react-ui/Spinner';
import {
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type UIEventHandler,
  useLayoutEffect,
  useRef,
} from 'react';
import { cn } from '@/utils/cn';
import styles from './MentionPanel.module.css';

export type MentionPanelPosition = 'above' | 'below';

/**
 * A press in the panel never moves the focus: the editor keeps its caret (and
 * a draft reply is not blurred away) also on a press on a group title, a
 * state or the padding. A field of the panel (the search of the models) takes
 * the focus as usual, and so does the panel itself, whose own target is its
 * scrollbar.
 */
function keepFocus(event: MouseEvent<HTMLDivElement>) {
  const target = event.target;
  if (!(target instanceof Element) || target === event.currentTarget) return;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) {
    return;
  }
  event.preventDefault();
}

type MentionPanelProps = {
  /** Where the panel opens, next to the composer */
  position?: MentionPanelPosition;
  /** Runs on a mousedown out of the panel */
  onClose: () => void;
  /** The scroll container of the options (the kit panel) */
  panelRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  children: ReactNode;
};

/**
 * The layer of the mention menus. They follow the caret of the editor, which
 * keeps the focus and drives the highlight, thus they are not a Dropdown: they
 * render the parts of the kit menu, under (or above) the composer.
 */
export function MentionPanel({
  position = 'below',
  onClose,
  panelRef,
  onScroll,
  children,
}: MentionPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, onClose);

  return (
    <NewZIndex>
      {(zIndex) => (
        <Dropdown.MenuContainer
          ref={containerRef}
          className={cn(styles.place, position === 'above' && styles.above)}
          style={{ zIndex }}
          data-side={position === 'above' ? 'top' : 'bottom'}
        >
          <Dropdown.MenuPanel
            ref={panelRef}
            onScroll={onScroll}
            onMouseDown={keepFocus}
          >
            {children}
          </Dropdown.MenuPanel>
        </Dropdown.MenuContainer>
      )}
    </NewZIndex>
  );
}

type MentionMenuItemProps = {
  /** The keyboard highlight */
  selected: boolean;
  /** Runs on click (and on Enter or Space on the option) */
  onPick: () => void;
  /** Moves the highlight to the option below the pointer */
  onHighlight?: () => void;
  /** Runs on mousedown, before the pick (the field views mark the click) */
  onPress?: () => void;
  /** Gets the row while it is the highlighted one, to scroll it into view */
  highlightRef?: Ref<HTMLDivElement>;
  icon?: ReactNode;
  /** Content of the row before the option content (an indent) */
  before?: ReactNode;
  after?: ReactNode;
  /** The index of the row, for the windowed lists */
  row?: number;
  children: ReactNode;
};

/**
 * An option of a mention panel. The whole row picks, as the options of the
 * kit menus do. A mousedown never moves the focus, so the editor keeps its
 * caret (and a draft reply is not blurred away); the pick runs on click, once.
 */
export function MentionMenuItem({
  selected,
  onPick,
  onHighlight,
  onPress,
  highlightRef,
  icon,
  before,
  after,
  row,
  children,
}: MentionMenuItemProps) {
  return (
    <Dropdown.MenuItem
      ref={selected ? highlightRef : undefined}
      selected={selected}
      clickable
      icon={icon}
      before={before}
      after={after}
      data-mention-row={row}
      onMouseDown={(event) => {
        event.preventDefault();
        onPress?.();
      }}
      onClick={() => onPick()}
      // Only a move of the pointer moves the highlight: a list that scrolls
      // under a still pointer (arrow keys) keeps the keyboard highlight.
      onMouseMove={selected ? undefined : onHighlight}
    >
      {children}
    </Dropdown.MenuItem>
  );
}

/** What follows an option: the typed command, a count, a pill, a chevron */
export function MentionItemMeta({ children }: { children: ReactNode }) {
  return <span className={styles.meta}>{children}</span>;
}

/** A state in place of the options, with a spinner */
export function MentionPanelLoading({ children }: { children: ReactNode }) {
  return (
    <Dropdown.MenuEmpty>
      <span className={styles.state}>
        <Spinner inline label={false} />
        {children}
      </span>
    </Dropdown.MenuEmpty>
  );
}

/** A state in place of the options, with an action after the text */
export function MentionPanelMessage({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Dropdown.MenuEmpty>
      <span className={styles.state}>
        {children}
        {action}
      </span>
    </Dropdown.MenuEmpty>
  );
}

/**
 * The height of the sticky title that holds the element: the title of a
 * drill-down holds the Back button, thus it is taller than a title of text.
 */
function getPinnedHeight(panel: HTMLElement, pinned: HTMLElement): number {
  let element: HTMLElement | null = pinned;
  while (element && element !== panel) {
    if (getComputedStyle(element).position === 'sticky') {
      return element.getBoundingClientRect().height;
    }
    element = element.parentElement;
  }
  return pinned.getBoundingClientRect().height;
}

/**
 * The part of the panel that the options can use, in the coordinates of its
 * scroll: the sticky group title takes the top (the kit gives it as the
 * scroll padding of the panel). A title with more than text (pinned) gives
 * its own height.
 */
export function getPanelViewport(
  panel: HTMLElement,
  pinned?: HTMLElement | null,
) {
  const style = getComputedStyle(panel);
  const paddingTop = Math.max(
    Number.parseFloat(style.scrollPaddingTop) || 0,
    pinned ? getPinnedHeight(panel, pinned) : 0,
  );
  const paddingBottom = Number.parseFloat(style.scrollPaddingBottom) || 0;
  return {
    top: panel.scrollTop + paddingTop,
    bottom: panel.scrollTop + (panel.clientHeight || 280) - paddingBottom,
  };
}

/** The top of an element in the coordinates of the scroll of the panel */
export function getOffsetInPanel(panel: HTMLElement, element: HTMLElement) {
  return (
    element.getBoundingClientRect().top -
    panel.getBoundingClientRect().top -
    panel.clientTop +
    panel.scrollTop
  );
}

/**
 * Scrolls the panel, and only the panel, until the element shows. The
 * browser's scrollIntoView would also scroll the frame and the CMS around it.
 */
export function scrollIntoPanel(
  panel: HTMLElement,
  element: HTMLElement,
  pinned?: HTMLElement | null,
) {
  const viewport = getPanelViewport(panel, pinned);
  const top = getOffsetInPanel(panel, element);
  const bottom = top + element.getBoundingClientRect().height;

  if (top < viewport.top) {
    panel.scrollTop -= viewport.top - top;
  } else if (bottom > viewport.bottom) {
    panel.scrollTop += bottom - viewport.bottom;
  }
}

/**
 * Keeps the highlighted option in view when the highlight (the key) moves.
 * The key, not each render, runs it: a list that the user scrolled with the
 * wheel stays where it is when the parent renders again. pinnedRef is the
 * content of a group title taller than text (a drill-down with Back).
 */
export function useKeepHighlightInView(
  panelRef: RefObject<HTMLElement | null>,
  highlightRef: RefObject<HTMLElement | null>,
  key: unknown,
  pinnedRef?: RefObject<HTMLElement | null>,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key tells when the highlight moved
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const highlighted = highlightRef.current;
    if (panel && highlighted) {
      scrollIntoPanel(panel, highlighted, pinnedRef?.current);
    }
  }, [key]);
}
