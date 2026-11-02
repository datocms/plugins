import type { ModelInfo } from '@hooks/useMentions';
import EntityRow from 'datocms-react-ui/EntityRow';
import Pill from 'datocms-react-ui/Pill';
import type { ReactNode } from 'react';
import { MentionDropdownBase } from './shared/MentionDropdownBase';
import type { MentionPanelPosition } from './shared/MentionPanel';

type ModelMentionDropdownProps = {
  models: ModelInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (model: ModelInfo) => void;
  onClose: () => void;
  /** Moves the highlight to the model below the pointer */
  onHover?: (index: number) => void;
  position?: MentionPanelPosition;
  /** The search field of the panel opened from the Mention menu */
  searchSlot?: ReactNode;
};

const ModelMentionDropdown = ({
  models,
  query,
  selectedIndex,
  onSelect,
  onClose,
  onHover,
  position = 'below',
  searchSlot,
}: ModelMentionDropdownProps) => {
  const emptyMessage = query ? `No models match “${query}”` : 'No models';

  return (
    <MentionDropdownBase
      items={models}
      emptyMessage={emptyMessage}
      headerText="Models"
      selectedIndex={selectedIndex}
      onClose={onClose}
      onHighlight={onHover}
      position={position}
      searchSlot={searchSlot}
      keyExtractor={(model) => model.id}
      renderItem={(model) => ({
        label: (
          <EntityRow
            layout="row"
            title={model.name}
            // A block is a state of the model: the row places its pill. The
            // API key only matches the search.
            afterTitle={model.isBlockModel ? <Pill>Block</Pill> : undefined}
          />
        ),
        onPick: () => onSelect(model),
      })}
    />
  );
};

export default ModelMentionDropdown;
