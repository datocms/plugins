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

/**
 * MentionChip - Renders a styled mention chip for use in both
 * the composer (contentEditable) and comment display.
 *
 * In composer mode, clicking navigates to the relevant entity.
 *
 * Memoized to maintain optimization chain with MentionDisplay.
 * Note: onClick should be wrapped in useCallback by callers for memo to be effective.
 *
 * PERFORMANCE NOTE: We intentionally pass onClick and mention directly to the handler
 * instead of wrapping in useCallback with mention as a dependency. The mention object
 * may be recreated on each render, which would defeat memoization. The parent's custom
 * comparator (in MentionDisplay) already handles deep comparison of mentions, so the
 * memo will still be effective. See MentionDisplay for the comparison logic.
 */
const MentionChipComponent = ({ mention, onClick, isInComposer = false, projectUsers }: MentionChipProps) => {
  // Create handler inline - the memo on this component with MentionDisplay's custom
  // comparator handles the optimization. Adding useCallback with `mention` dependency
  // would create a new function every render anyway since mention objects are recreated.
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
