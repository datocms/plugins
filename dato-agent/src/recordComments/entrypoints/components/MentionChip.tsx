import type { Mention } from '@ctypes/mentions';
import type { UserInfo } from '@hooks/useMentions';
import { memo, useCallback } from 'react';
import { MentionDisplay } from './shared/MentionDisplay';

type MentionChipProps = {
  mention: Mention;
  onClick?: (mention: Mention, event: React.MouseEvent) => void;
  isInComposer?: boolean;
  /** Optional project users for resolving user mention name overrides */
  projectUsers?: UserInfo[];
  currentRecordId?: string;
};

/** Renders a mention chip. Memoized; MentionDisplay handles deep comparison. */
const MentionChipComponent = ({
  mention,
  onClick,
  isInComposer = false,
  projectUsers,
  currentRecordId,
}: MentionChipProps) => {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onClick?.(mention, e);
    },
    [mention, onClick],
  );

  return (
    <MentionDisplay
      mention={mention}
      onClick={handleClick}
      inComposer={isInComposer}
      projectUsers={projectUsers}
      currentRecordId={currentRecordId}
    />
  );
};

export const MentionChip = memo(MentionChipComponent);
