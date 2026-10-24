import type { ModelInfo } from '@hooks/useMentions';
import ApiKey from 'datocms-react-ui/ApiKey';
import Pill from 'datocms-react-ui/Pill';
import { ModelIcon } from '../../../icons';
import { MentionDropdownBase } from './shared/MentionDropdownBase';

type ModelMentionDropdownProps = {
  models: ModelInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (model: ModelInfo) => void;
  onClose: () => void;
  position?: 'above' | 'below';
  onSelectedIndexChange?: (index: number) => void;
};

const ModelMentionDropdown = ({
  models,
  query,
  selectedIndex,
  onSelect,
  onClose,
  position = 'below',
  onSelectedIndexChange,
}: ModelMentionDropdownProps) => (
  <MentionDropdownBase
    emptyMessage={query ? `No models match “${query}”` : 'No models available'}
    headerIcon={<ModelIcon />}
    headerText="Models"
    items={models}
    keyExtractor={(model) => model.id}
    onClose={onClose}
    onSelect={onSelect}
    onSelectedIndexChange={onSelectedIndexChange}
    position={position}
    renderOption={(model) => ({
      title: model.name,
      afterTitle: (
        <>
          <ApiKey>{model.apiKey}</ApiKey>
          {model.isBlockModel && <Pill>Block</Pill>}
        </>
      ),
    })}
    selectedIndex={selectedIndex}
  />
);

export default ModelMentionDropdown;
