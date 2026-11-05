import {
  type NavigationStep,
  useFieldNavigation,
} from '@hooks/useFieldNavigation';
import type { FieldInfo } from '@hooks/useMentions';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import {
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
} from 'react';
import { BlockPickerView } from './field-dropdown/BlockPickerView';
import { FieldDropdownHeader } from './field-dropdown/FieldDropdownHeader';
import { FieldListView } from './field-dropdown/FieldListView';
import { LocalePickerView } from './field-dropdown/LocalePickerView';
import { NestedFieldsView } from './field-dropdown/NestedFieldsView';
import {
  MentionPanel,
  MentionPanelLoading,
  MentionPanelMessage,
  type MentionPanelPosition,
  useKeepHighlightInView,
} from './shared/MentionPanel';

type FieldMentionDropdownProps = {
  fields: FieldInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (field: FieldInfo, locale?: string) => void;
  onClose: () => void;
  /** Moves the highlight of the field list to the field below the pointer */
  onHover?: (index: number) => void;
  pendingFieldForLocale?: FieldInfo | null;
  onClearPendingField?: () => void;
  ctx?: RenderItemFormSidebarCtx;
  registerKeyHandler?: (handler: (key: string) => boolean) => void;
  position?: MentionPanelPosition;
  /** Called when field navigation path changes (for updating editor preview) */
  onPathChange?: (path: string) => void;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  /**
   * The search field of the panel opened from the Mention menu. It shows
   * above the list of the fields: a step further has its own title.
   */
  searchSlot?: ReactNode;
};

function stepLabel(step: NavigationStep): string {
  if (step.type === 'field') return step.field.label;
  if (step.type === 'locale') return step.locale.toUpperCase();
  return `${step.blockModelName} #${step.blockIndex + 1}`;
}

/** The path of a drill-down for its title: "Content · IT · Blocks" */
function displayPath(stack: NavigationStep[], ...tail: string[]): string {
  return [...stack.map(stepLabel), ...tail].join(' · ');
}

type FieldListStateProps = {
  isLoading: boolean;
  errorMessage: string | null;
  query: string;
  onRetry?: () => void;
  justClickedInsideRef: MutableRefObject<boolean>;
};

/** The field list while it loads, when it failed, or when nothing matches */
function FieldListState({
  isLoading,
  errorMessage,
  query,
  onRetry,
  justClickedInsideRef,
}: FieldListStateProps): ReactNode {
  if (isLoading) {
    return <MentionPanelLoading>Loading fields…</MentionPanelLoading>;
  }

  if (errorMessage) {
    return (
      <MentionPanelMessage
        action={
          onRetry && (
            <Button
              tone="ghost"
              label="Try again"
              onMouseDown={(event) => {
                // The editor keeps the focus, and the panel stays open
                event.preventDefault();
                justClickedInsideRef.current = true;
              }}
              onClick={() => onRetry()}
            />
          )
        }
      >
        {errorMessage}
      </MentionPanelMessage>
    );
  }

  return (
    <Dropdown.MenuEmpty>
      {query ? `No fields match “${query}”` : 'No fields'}
    </Dropdown.MenuEmpty>
  );
}

const FieldMentionDropdown = ({
  fields,
  query,
  selectedIndex,
  onSelect,
  onClose,
  onHover,
  pendingFieldForLocale,
  onClearPendingField,
  ctx,
  registerKeyHandler,
  position = 'below',
  onPathChange,
  isLoading = false,
  errorMessage = null,
  onRetry,
  searchSlot,
}: FieldMentionDropdownProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  // The title of a drill-down (Back and the path)
  const headerRef = useRef<HTMLSpanElement>(null);
  // A mousedown inside the panel that changes its view must not count as a
  // click outside (the clicked element can leave the DOM before the check)
  const justClickedInsideRef = useRef(false);

  const handleClickOutside = () => {
    if (justClickedInsideRef.current) {
      justClickedInsideRef.current = false;
      return;
    }
    onClose();
  };

  // The picks run on click, after the check of the mousedown: a mark left by
  // a click inside must not swallow the next click outside.
  useEffect(() => {
    const clearMark = () => {
      justClickedInsideRef.current = false;
    };
    document.addEventListener('click', clearMark);
    return () => document.removeEventListener('click', clearMark);
  }, []);

  const {
    navigationStack,
    localSelectedIndex,
    setLocalSelectedIndex,
    currentBlocks,
    currentNestedFields,
    isLoadingBlocks,
    viewMode,
    currentField,
    handleBack,
    handleFieldClick,
    handleLocaleClick,
    handleBlockClick,
    handleSelectEntireField,
    handleKeyboardNavigation,
    handlePendingLocaleSelection,
  } = useFieldNavigation({
    ctx,
    onSelect,
    pendingFieldForLocale,
    onClearPendingField,
    selectedIndex,
    onPathChange,
  });

  useKeepHighlightInView(
    panelRef,
    selectedRef,
    [
      viewMode,
      navigationStack.length,
      Boolean(pendingFieldForLocale),
      selectedIndex,
      localSelectedIndex,
    ].join(':'),
    headerRef,
  );

  // Register keyboard handler with parent
  useEffect(() => {
    if (registerKeyHandler) {
      registerKeyHandler(handleKeyboardNavigation);
    }
  }, [registerKeyHandler, handleKeyboardNavigation]);

  const viewProps = {
    selectedRef,
    justClickedInsideRef,
  };
  // The counts and the names of the languages, in the language of the user
  const uiLocale = ctx?.ui.locale;

  // The search field and a state of the list come only with the fields of
  // the record. While the user searches, the kit hides a group with no
  // option: the state follows the group, so that it shows.
  const panel = (
    title: string | ReactElement,
    body: ReactNode,
    search?: ReactNode,
    listState?: ReactNode,
  ) => (
    <MentionPanel
      position={position}
      onClose={handleClickOutside}
      panelRef={panelRef}
    >
      {search}
      {/* As in the kit menu, the options are in a box after the search
          field: the field has its own line, the group adds none */}
      <div>
        <Dropdown.MenuGroup title={title}>{body}</Dropdown.MenuGroup>
        {listState}
      </div>
    </MentionPanel>
  );

  const header = (title: string, onBack: () => void) => (
    <FieldDropdownHeader
      ref={headerRef}
      title={title}
      onBack={onBack}
      justClickedInsideRef={justClickedInsideRef}
    />
  );

  // Pending locale selection mode (from keyboard navigation)
  if (pendingFieldForLocale?.availableLocales && navigationStack.length === 0) {
    return panel(
      header(`${pendingFieldForLocale.label} · Language`, () =>
        onClearPendingField?.(),
      ),
      <LocalePickerView
        {...viewProps}
        uiLocale={uiLocale}
        locales={pendingFieldForLocale.availableLocales}
        selectedIndex={localSelectedIndex}
        onSelect={handlePendingLocaleSelection}
        onHover={setLocalSelectedIndex}
      />,
    );
  }

  if (
    viewMode === 'fields' &&
    (isLoading || errorMessage || fields.length === 0)
  ) {
    return panel(
      'Fields',
      null,
      searchSlot,
      <FieldListState
        isLoading={isLoading}
        errorMessage={errorMessage}
        query={query}
        onRetry={onRetry}
        justClickedInsideRef={justClickedInsideRef}
      />,
    );
  }

  // Locale picker view (drill-down mode)
  if (viewMode === 'locales' && currentField?.availableLocales) {
    return panel(
      header(displayPath(navigationStack, 'Language'), handleBack),
      <LocalePickerView
        {...viewProps}
        uiLocale={uiLocale}
        locales={currentField.availableLocales}
        selectedIndex={localSelectedIndex}
        onSelect={handleLocaleClick}
        onHover={setLocalSelectedIndex}
      />,
    );
  }

  if (viewMode === 'blocks') {
    return panel(
      header(displayPath(navigationStack, 'Blocks'), handleBack),
      <BlockPickerView
        {...viewProps}
        blocks={currentBlocks}
        selectedIndex={localSelectedIndex}
        isLoading={isLoadingBlocks}
        onSelectEntireField={handleSelectEntireField}
        onSelectBlock={handleBlockClick}
        onHover={setLocalSelectedIndex}
      />,
    );
  }

  // The fields inside a block
  if (viewMode === 'nestedFields') {
    return panel(
      header(displayPath(navigationStack), handleBack),
      <NestedFieldsView
        {...viewProps}
        uiLocale={uiLocale}
        fields={currentNestedFields}
        selectedIndex={localSelectedIndex}
        isLoading={isLoadingBlocks}
        onSelect={handleFieldClick}
        onHover={setLocalSelectedIndex}
      />,
    );
  }

  return panel(
    'Fields',
    <FieldListView
      {...viewProps}
      uiLocale={uiLocale}
      fields={fields}
      selectedIndex={selectedIndex}
      onSelect={handleFieldClick}
      onHover={onHover}
    />,
    searchSlot,
  );
};

export default FieldMentionDropdown;
