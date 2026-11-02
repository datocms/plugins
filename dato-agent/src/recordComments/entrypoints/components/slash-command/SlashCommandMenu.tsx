import type { SlashCommandDefinition } from '@ctypes/slashCommands';
import { type ComponentType, memo, type SVGProps } from 'react';
import {
  AssetIcon,
  FieldIcon,
  ModelIcon,
  RecordIcon,
  UserIcon,
} from '../../../../icons';
import { MentionDropdownBase } from '../shared/MentionDropdownBase';

type SlashCommandMenuProps = {
  commands: SlashCommandDefinition[];
  selectedIndex: number;
  onSelect: (command: SlashCommandDefinition) => void;
  onClose: () => void;
  onSelectedIndexChange?: (index: number) => void;
  position?: 'above' | 'below';
};

const commandIcons: Record<
  SlashCommandDefinition['name'],
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  user: UserIcon,
  field: FieldIcon,
  record: RecordIcon,
  asset: AssetIcon,
  model: ModelIcon,
};

export const SlashCommandMenu = memo(function SlashCommandMenu({
  commands,
  selectedIndex,
  onSelect,
  onClose,
  onSelectedIndexChange,
  position = 'below',
}: SlashCommandMenuProps) {
  return (
    <MentionDropdownBase
      emptyMessage="No matching references"
      headerText="Mention"
      items={commands}
      keyExtractor={(command) => command.name}
      onClose={onClose}
      onSelect={onSelect}
      onSelectedIndexChange={onSelectedIndexChange}
      position={position}
      renderOption={(command) => {
        const Icon = commandIcons[command.name];
        return {
          icon: <Icon />,
          title: command.label,
          details: command.description,
        };
      }}
      selectedIndex={selectedIndex}
    />
  );
});
