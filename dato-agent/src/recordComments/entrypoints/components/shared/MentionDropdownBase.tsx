import Button from 'datocms-react-ui/Button';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import { useClickOutside } from 'datocms-react-ui/hooks/useClickOutside';
import NewZIndex from 'datocms-react-ui/NewZIndex';
import Spinner from 'datocms-react-ui/Spinner';
import { type ReactNode, useEffect, useRef } from 'react';
import { MentionDropdownOptionContent } from './MentionDropdownOptionContent';
import styles from './MentionMenu.module.css';

const {
  MenuContainer,
  MenuEmpty,
  MenuGroup,
  MenuItem,
  MenuPanel,
  Text: MenuText,
} = Dropdown;

/** What an option of a mention menu shows */
export type MentionOptionView = {
  /** A glyph before the text, when the options of the menu differ in kind */
  icon?: ReactNode;
  /** The picture of the entity (an avatar), in the slot of the row */
  image?: ReactNode;
  title: string;
  /** After the title, on the same line: an API key, a pill */
  afterTitle?: ReactNode;
  /** A second line in the subtle ink: an email, a description */
  details?: ReactNode;
};

type MentionDropdownBaseProps<T> = {
  items: T[];
  keyExtractor: (item: T) => string;
  renderOption: (item: T) => MentionOptionView;
  onSelect: (item: T) => void;
  /** The option that the keyboard highlights (the editor owns the index) */
  selectedIndex: number;
  /** The pointer moved on an option: the keyboard continues from it */
  onSelectedIndexChange?: (index: number) => void;
  onClose: () => void;
  /** The title of the group, and the name of the menu */
  headerText: string;
  /**
   * Before the title: the glyph of the kind that all the options share (the
   * options then have none), or the back button of a second step
   */
  headerIcon?: ReactNode;
  position?: 'above' | 'below';
  /** The text in place of the options when there is none */
  emptyMessage: string;
  /** A line above the options: a refresh that runs or failed */
  status?: string;
  /** A spinner before the status and the empty text */
  busy?: boolean;
  /** A Retry after the status and the empty text */
  onRetry?: () => void;
  /** A search field above the options, for a panel that has its own keyboard */
  search?: ReactNode;
  /**
   * The id of the list of options. Each option then has the id
   * `<id>-<index>`, for the aria-activedescendant of the field that owns the
   * keyboard.
   */
  id?: string;
};

/** The id of an option of a menu that has an id */
export function mentionOptionId(menuId: string, index: number) {
  return `${menuId}-${index}`;
}

/** A click in the menu must not take the focus from the editor */
export function keepEditorFocus(event: React.MouseEvent) {
  event.preventDefault();
}

/** TipTap owns the keyboard: the options are not tab stops */
const OPTION_CONTENT_PROPS = { tabIndex: -1 };

/**
 * A menu of references that follows the editor of the composer: the editor
 * keeps the focus and moves the highlighted option, thus it is built from the
 * parts of a menu, not a Dropdown or a Popover.
 */
export function MentionDropdownBase<T>({
  items,
  keyExtractor,
  renderOption,
  onSelect,
  selectedIndex,
  onSelectedIndexChange,
  onClose,
  headerText,
  headerIcon,
  position = 'below',
  emptyMessage,
  status,
  busy = false,
  onRetry,
  search,
  id,
}: MentionDropdownBaseProps<T>): ReactNode {
  const menuRef = useClickOutside<HTMLDivElement>(onClose);
  const selectedRef = useRef<HTMLDivElement>(null);
  const options = items.map((item) => ({ item, view: renderOption(item) }));

  // The highlighted option stays in view while the keyboard moves it
  useEffect(() => {
    if (selectedIndex < 0) return;
    const selected = selectedRef.current;
    if (selected && typeof selected.scrollIntoView === 'function') {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const renderState = (text: string) => (
    <span className={styles.status}>
      <span className={styles.statusText}>
        {busy && <Spinner inline label={false} />}
        <span>{text}</span>
      </span>
      {onRetry && (
        <Button
          label="Retry"
          onClick={onRetry}
          onMouseDown={keepEditorFocus}
          size="micro"
          tone="ghost"
        />
      )}
    </span>
  );

  return (
    <NewZIndex>
      {(zIndex) => (
        <MenuContainer
          className={`${styles.menu} ${position === 'above' ? styles.above : styles.below}`}
          data-side={position === 'above' ? 'top' : 'bottom'}
          ref={menuRef}
          style={{ zIndex }}
        >
          <MenuPanel>
            {search}
            <MenuGroup icon={headerIcon} title={headerText}>
              {status && items.length > 0 && (
                <div role="status">
                  <MenuText>{renderState(status)}</MenuText>
                </div>
              )}
              {items.length === 0 ? (
                <div role="status">
                  <MenuEmpty>{renderState(emptyMessage)}</MenuEmpty>
                </div>
              ) : (
                <div
                  aria-label={headerText}
                  className={styles.options}
                  id={id}
                  role="menu"
                >
                  {options.map(({ item, view }, index) => {
                    const isSelected = index === selectedIndex;

                    return (
                      <MenuItem
                        clickable
                        contentProps={OPTION_CONTENT_PROPS}
                        icon={view.icon}
                        id={id ? mentionOptionId(id, index) : undefined}
                        key={keyExtractor(item)}
                        onClick={() => onSelect(item)}
                        onMouseDown={keepEditorFocus}
                        onMouseEnter={() => onSelectedIndexChange?.(index)}
                        ref={isSelected ? selectedRef : undefined}
                        role="menuitem"
                        selected={isSelected}
                      >
                        <MentionDropdownOptionContent
                          afterTitle={view.afterTitle}
                          details={view.details}
                          image={view.image}
                          title={view.title}
                        />
                      </MenuItem>
                    );
                  })}
                </div>
              )}
            </MenuGroup>
          </MenuPanel>
        </MenuContainer>
      )}
    </NewZIndex>
  );
}
