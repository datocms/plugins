import type { ModelInfo } from '@hooks/useMentions';
import ApiKey from 'datocms-react-ui/ApiKey';
import EntityRow from 'datocms-react-ui/EntityRow';
import Pill from 'datocms-react-ui/Pill';
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
};

const ModelMentionDropdown = ({
  models,
  query,
  selectedIndex,
  onSelect,
  onClose,
  onHover,
  position = 'below',
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
      keyExtractor={(model) => model.id}
      renderItem={(model) => ({
        label: (
          <EntityRow
            layout="row"
            title={model.name}
            // A block is a state of the model: the row places its pill
            afterTitle={
              <>
                <ApiKey>{model.apiKey}</ApiKey>
                {model.isBlockModel && <Pill>Block</Pill>}
              </>
            }
          />
        ),
        onPick: () => onSelect(model),
      })}
    />
  );
};

export default ModelMentionDropdown;
