import type {
  SlashCommandDefinition,
  SlashCommandType,
} from '@ctypes/slashCommands';
import { type ComponentType, memo, type SVGProps } from 'react';
import {
  AssetMentionIcon,
  FieldMentionIcon,
  ModelMentionIcon,
  RecordMentionIcon,
  UserMentionIcon,
} from '../Icons';
import { MentionDropdownBase } from '../shared/MentionDropdownBase';
import {
  MentionItemMeta,
  type MentionPanelPosition,
} from '../shared/MentionPanel';

const COMMAND_ICONS: Record<
  SlashCommandType,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  user: UserMentionIcon,
  field: FieldMentionIcon,
  record: RecordMentionIcon,
  asset: AssetMentionIcon,
  model: ModelMentionIcon,
};

type SlashCommandMenuProps = {
  commands: SlashCommandDefinition[];
  selectedIndex: number;
  onSelect: (command: SlashCommandDefinition) => void;
  onClose: () => void;
  /** Moves the highlight to the command below the pointer */
  onHover?: (index: number) => void;
  position?: MentionPanelPosition;
};

export const SlashCommandMenu = memo(function SlashCommandMenu({
  commands,
  selectedIndex,
  onSelect,
  onClose,
  onHover,
  position = 'below',
}: SlashCommandMenuProps) {
  return (
    <MentionDropdownBase
      items={commands}
      emptyMessage="No matching commands"
      headerText="Insert"
      selectedIndex={selectedIndex}
      onClose={onClose}
      onHighlight={onHover}
      position={position}
      keyExtractor={(command) => command.name}
      renderItem={(command) => {
        const Icon = COMMAND_ICONS[command.name];
        return {
          icon: <Icon />,
          label: command.label,
          after: <MentionItemMeta>/{command.name}</MentionItemMeta>,
          onPick: () => onSelect(command),
        };
      }}
    />
  );
});
