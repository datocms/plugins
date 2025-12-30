import { memo } from 'react';
import type { Mention } from '@ctypes/mentions';
import type { UserInfo } from '@hooks/useMentions';
import { MentionDisplay } from './shared/MentionDisplay';

type MentionChipProps = {
  mention: Mention;
  onClick?: (mention: Mention, event: React.MouseEvent) => void;
  isInComposer?: boolean;
  /** Optional project users for resolving user mention name overrides */
  projectUsers?: UserInfo[];
};

/** Renders a styled mention chip. Memoized; MentionDisplay handles deep comparison. */
const MentionChipComponent = ({ mention, onClick, isInComposer = false, projectUsers }: MentionChipProps) => {
  const handleClick = (e: React.MouseEvent) => {
    onClick?.(mention, e);
  };

  return (
    <MentionDisplay
      mention={mention}
      onClick={handleClick}
      tabIndex={isInComposer ? -1 : 0}
      projectUsers={projectUsers}
    />
  );
};

export const MentionChip = memo(MentionChipComponent);
