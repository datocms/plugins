import type { ModelInfo } from '@hooks/useMentions';
import ApiKey from 'datocms-react-ui/ApiKey';
import { Dropdown, useMenuSearchTerm } from 'datocms-react-ui/Dropdown';
import { EditorToolbar } from 'datocms-react-ui/EditorToolbar';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import StringInput from 'datocms-react-ui/StringInput';
import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { RecordIcon } from '../../../icons';
import {
  MentionDropdownBase,
  mentionOptionId,
} from './shared/MentionDropdownBase';
import { MentionDropdownOptionContent } from './shared/MentionDropdownOptionContent';

/** The example of the search fields: the name of a model */
const SEARCH_PLACEHOLDER = 'Blog post';

/** The title of the list of the models, and of the record kind */
const RECORDS_TITLE = 'Records';

function matchesQuery(model: ModelInfo, query: string) {
  return (
    model.name.toLowerCase().includes(query) ||
    model.apiKey.toLowerCase().includes(query)
  );
}

/** The models with records to pick (block models have none) */
function readableModels(models: readonly ModelInfo[]) {
  return models.filter((model) => !model.isBlockModel);
}

/** The text in place of the models when none matches */
function emptyText(query: string, readable: readonly ModelInfo[]): string {
  if (query) return `No models match “${query}”`;
  return readable.length === 0
    ? 'No models you can read'
    : 'No models available';
}

type RecordModelPanelProps = {
  models: readonly ModelInfo[];
  onSelect: (model: ModelInfo) => void;
  /** Escape or a click out of the panel: the editor gets the focus back */
  onClose: () => void;
  /** The focus left the panel (Tab): it closes and the focus stays there */
  onLeave: () => void;
  position?: 'above' | 'below';
};

/**
 * The first step of a record mention from the "/" command: a panel of the
 * models next to the editor, as the other steps of the command, with a search
 * that takes the focus. The first match is highlighted: Enter or Tab picks
 * it, the arrows move the highlight, Escape closes the panel.
 *
 * The command has no trigger, thus it is a panel of its own; the insert
 * toolbar opens the same models in a real dropdown (RecordMentionDropdown).
 */
export function RecordModelPanel({
  models,
  onSelect,
  onClose,
  onLeave,
  position = 'above',
}: RecordModelPanelProps) {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const query = search.trim();
  const readable = useMemo(() => readableModels(models), [models]);
  const matchingModels = useMemo(
    () => readable.filter((model) => matchesQuery(model, query.toLowerCase())),
    [query, readable],
  );
  // The highlight stays on a match while the list narrows or grows
  const highlighted = Math.max(
    0,
    Math.min(selectedIndex, matchingModels.length - 1),
  );

  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLInputElement>('input[type="text"]')
      ?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The key that ends an IME composition is not a command
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex(
          Math.max(0, Math.min(highlighted + 1, matchingModels.length - 1)),
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        setSelectedIndex(Math.max(highlighted - 1, 0));
        break;
      case 'Enter':
      case 'Tab': {
        // With no match, Tab moves the focus on: it is never trapped
        const model = matchingModels[highlighted];
        if (!model) break;
        event.preventDefault();
        onSelect(model);
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
    }
  };

  // Only a focus that moves to another control leaves the panel (Tab): a
  // press on the panel itself keeps the focus in the search (see below), and
  // a click out of it closes the panel through onClose
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || panelRef.current?.contains(next)) return;
    onLeave();
  };

  // A press on the title of the group, a text or the padding of the panel
  // must not take the focus from the search. The options already keep it.
  const keepSearchFocus = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('input')) {
      return;
    }
    event.preventDefault();
  };

  return (
    <div
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onMouseDown={keepSearchFocus}
      ref={panelRef}
    >
      <MentionDropdownBase
        emptyMessage={emptyText(query, readable)}
        headerIcon={<RecordIcon />}
        headerText={RECORDS_TITLE}
        id={menuId}
        items={matchingModels}
        keyExtractor={(model) => model.id}
        onClose={onClose}
        onSelect={onSelect}
        onSelectedIndexChange={setSelectedIndex}
        position={position}
        renderOption={(model) => ({
          title: model.name,
          afterTitle: <ApiKey>{model.apiKey}</ApiKey>,
        })}
        search={
          // Content of the panel that is not an option. The search has a
          // field of its own, thus it is not the input of the message field
          // around the panel.
          <div className="Dropdown__menu__body">
            <FieldWrapper
              label="Search record models"
              labelExtras={{ hidden: true }}
            >
              <StringInput
                // The search keeps the focus: it tells which model Enter picks
                aria-activedescendant={
                  matchingModels.length > 0
                    ? mentionOptionId(menuId, highlighted)
                    : undefined
                }
                aria-controls={matchingModels.length > 0 ? menuId : undefined}
                autoComplete="off"
                onChange={(value) => {
                  setSearch(value ?? '');
                  setSelectedIndex(0);
                }}
                placeholder={SEARCH_PLACEHOLDER}
                spellCheck={false}
                value={search}
              />
            </FieldWrapper>
          </div>
        }
        selectedIndex={highlighted}
      />
    </div>
  );
}

type RecordModelOptionsProps = {
  models: readonly ModelInfo[];
  onSelect: (model: ModelInfo) => void;
};

/**
 * The models of the toolbar dropdown, filtered by the search of the menu: by
 * name or API key, as the "/" command does. The menu always shows its
 * search, thus the field stays while the list narrows.
 */
function RecordModelOptions({ models, onSelect }: RecordModelOptionsProps) {
  // The term as the menu filters with it: a substring of the name or of the
  // API key (a keyword of the option) is also a match of the menu
  const searchTerm = useMenuSearchTerm();
  const readable = useMemo(() => readableModels(models), [models]);
  const matchingModels = readable.filter((model) =>
    matchesQuery(model, searchTerm.toLowerCase()),
  );
  // The search term re-renders this list with each render of the menu, and
  // an option registers its handler in the menu again whenever it changes:
  // the handlers stay the same between renders
  const pickHandlers = useMemo(
    () =>
      new Map(
        readable.map((model) => [model.id, () => onSelect(model)] as const),
      ),
    [onSelect, readable],
  );

  if (matchingModels.length === 0) {
    // Out of the group: while the user searches, a group without options
    // hides, its texts too
    return (
      <div role="status">
        <Dropdown.MenuEmpty>
          {emptyText(searchTerm, readable)}
        </Dropdown.MenuEmpty>
      </div>
    );
  }

  return (
    // Every option is a model of records: the glyph of the kind is on the
    // title of the group, and the options have none of their own
    <Dropdown.Group icon={<RecordIcon />} name={RECORDS_TITLE}>
      {matchingModels.map((model) => (
        <Dropdown.Option
          key={model.id}
          keywords={[model.apiKey]}
          onPick={pickHandlers.get(model.id)}
        >
          <MentionDropdownOptionContent
            afterTitle={<ApiKey>{model.apiKey}</ApiKey>}
            title={model.name}
          />
        </Dropdown.Option>
      ))}
    </Dropdown.Group>
  );
}

type RecordMentionDropdownProps = {
  models: readonly ModelInfo[];
  disabled?: boolean;
  /** The menu opens or closes: the toolbar stays visible while it is open */
  onToggle: (open: boolean) => void;
  /** A model is picked: the record picker of the host opens next */
  onSelect: (model: ModelInfo) => void;
};

/**
 * The record entry of the insert toolbar: a picker with a trigger, thus a
 * real dropdown of the editor toolbar. It lists the models with records
 * (block models have none) and has the search of the menu.
 */
export function RecordMentionDropdown({
  models,
  disabled = false,
  onToggle,
  onSelect,
}: RecordMentionDropdownProps) {
  const hasModels = readableModels(models).length > 0;

  return (
    <EditorToolbar.Dropdown
      disabled={disabled}
      icon={RecordIcon}
      label="Record"
      onToggle={onToggle}
    >
      <Dropdown.Menu contextualSearch={hasModels} minWidth={240}>
        <RecordModelOptions models={models} onSelect={onSelect} />
      </Dropdown.Menu>
    </EditorToolbar.Dropdown>
  );
}
