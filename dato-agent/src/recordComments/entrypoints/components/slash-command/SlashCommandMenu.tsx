import type { SlashCommandDefinition } from '@ctypes/slashCommands';
import styles from '@styles/comment.module.css';
import { memo, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import {
  AssetMentionIcon,
  FieldMentionIcon,
  ModelMentionIcon,
  RecordMentionIcon,
  UserMentionIcon,
} from '../Icons';
import { MentionDropdownBase } from '../shared/MentionDropdownBase';
import { MentionDropdownOptionContent } from '../shared/MentionDropdownOptionContent';

type SlashCommandMenuProps = {
  commands: SlashCommandDefinition[];
  selectedIndex: number;
  onSelect: (command: SlashCommandDefinition) => void;
  onClose: () => void;
  onSelectedIndexChange?: (index: number) => void;
  position?: 'above' | 'below';
};

const commandIcons: Record<SlashCommandDefinition['name'], ReactNode> = {
  user: <UserMentionIcon aria-hidden="true" />,
  field: <FieldMentionIcon aria-hidden="true" />,
  record: <RecordMentionIcon aria-hidden="true" />,
  asset: <AssetMentionIcon aria-hidden="true" />,
  model: <ModelMentionIcon aria-hidden="true" />,
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
      headerText="References"
      items={commands}
      keyExtractor={(command) => command.name}
      onClose={onClose}
      position={position}
      renderItem={(command, index, isSelected, selectedRef) => (
        <button
          className={cn(
            styles.mentionOption,
            styles.slashCommandItem,
            isSelected && styles.mentionOptionSelected,
          )}
          onClick={() => onSelect(command)}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onSelectedIndexChange?.(index)}
          ref={isSelected ? selectedRef : null}
          role="menuitem"
          type="button"
        >
          <MentionDropdownOptionContent
            description={command.description}
            leading={commandIcons[command.name]}
            title={command.label}
          />
        </button>
      )}
      selectedIndex={selectedIndex}
    />
  );
});
