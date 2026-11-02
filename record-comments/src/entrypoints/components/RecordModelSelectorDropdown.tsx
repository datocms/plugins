import type { ModelInfo } from '@hooks/useMentions';
import { getRecordMentionModels } from '@utils/permissions';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import EntityRow from 'datocms-react-ui/EntityRow';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { MentionDropdownBase } from './shared/MentionDropdownBase';
import type { MentionPanelPosition } from './shared/MentionPanel';

type RecordModelSelectorDropdownProps = {
  models: ModelInfo[];
  onSelect: (model: ModelInfo) => void;
  onClose: () => void;
  position?: MentionPanelPosition;
};

/** The models whose name or API key has the search, in any case */
export function filterRecordModels(
  models: ModelInfo[],
  query: string,
): ModelInfo[] {
  const lowerQuery = query.toLowerCase();
  return models.filter(
    (model) =>
      model.name.toLowerCase().includes(lowerQuery) ||
      model.apiKey.toLowerCase().includes(lowerQuery),
  );
}

/** What a list of models of a record mention says when it shows none */
export function getRecordModelsEmptyMessage(
  query: string,
  readableCount: number,
): string {
  if (query) return `No models match “${query}”`;
  if (readableCount === 0) return "You can't read any model.";
  return 'No models';
}

/**
 * The first step of a record mention (/record, or Record in the Mention
 * menu): the model of the record. The panel opens at the caret, as the other
 * mention panels do, and renders the parts of the kit menu. Its search field
 * has the focus, thus it owns the keys (the editor waits).
 */
const RecordModelSelectorDropdown = ({
  models,
  onSelect,
  onClose,
  position = 'below',
}: RecordModelSelectorDropdownProps) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const nonBlockModels = useMemo(
    () => getRecordMentionModels(models),
    [models],
  );

  const filteredModels = useMemo(
    () => filterRecordModels(nonBlockModels, query),
    [query, nonBlockModels],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: A new list starts from its first model.
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredModels]);

  const handleKeyDown = (e: KeyboardEvent) => {
    const selectedModel = filteredModels[selectedIndex];

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredModels.length - 1 ? prev + 1 : prev,
        );
        break;

      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;

      case 'Enter':
        e.preventDefault();
        if (selectedModel) {
          onSelect(selectedModel);
        }
        break;

      case 'Tab':
        e.preventDefault();
        if (selectedModel) {
          onSelect(selectedModel);
        }
        break;

      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  // The search of the kit menu. It takes the focus when the panel opens,
  // thus it also owns the keys of the panel: it shows with few models too.
  const searchSlot = (
    <Dropdown.MenuSearch
      autoFocus
      aria-label="Search models"
      placeholder="Search models…"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      onKeyDown={handleKeyDown}
    />
  );

  return (
    <MentionDropdownBase
      items={filteredModels}
      emptyMessage={getRecordModelsEmptyMessage(query, nonBlockModels.length)}
      // The model of the record to mention: the Model option of the
      // Mention menu mentions a model itself
      headerText="Model of the record"
      selectedIndex={selectedIndex}
      onClose={onClose}
      onHighlight={setSelectedIndex}
      position={position}
      keyExtractor={(model) => model.id}
      searchSlot={searchSlot}
      renderItem={(model) => ({
        label: (
          // The name, as the editors know the model: the API key only
          // matches the search
          <EntityRow layout="row" title={model.name} />
        ),
        onPick: () => onSelect(model),
      })}
    />
  );
};

export default RecordModelSelectorDropdown;
