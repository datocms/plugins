import type { UserInfo } from '@hooks/useMentions';
import { getAvatarImage } from '@utils/avatarImage';
import Avatar from 'datocms-react-ui/Avatar';
import Button from 'datocms-react-ui/Button';
import EntityRow from 'datocms-react-ui/EntityRow';
import type { ReactNode } from 'react';
import { MentionDropdownBase } from './shared/MentionDropdownBase';
import {
  MentionPanelLoading,
  MentionPanelMessage,
  type MentionPanelPosition,
} from './shared/MentionPanel';

type UserMentionDropdownProps = {
  users: UserInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (user: UserInfo) => void;
  onClose: () => void;
  /** Moves the highlight to the collaborator below the pointer */
  onHover?: (index: number) => void;
  position?: MentionPanelPosition;
  /** The collaborators did not load yet */
  isLoading?: boolean;
  /** The collaborators did not load */
  loadFailed?: boolean;
  /** Loads the collaborators again */
  onRetry?: () => void;
};

/** The list while the collaborators load, or after their load failed */
function getUsersState(
  isLoading: boolean,
  loadFailed: boolean,
  onRetry: (() => void) | undefined,
): ReactNode {
  if (loadFailed) {
    return (
      <MentionPanelMessage
        action={
          onRetry && (
            <Button
              tone="ghost"
              size="micro"
              label="Try again"
              // The editor keeps the focus, and the panel stays open
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onRetry()}
            />
          )
        }
      >
        The collaborators didn't load.
      </MentionPanelMessage>
    );
  }

  if (isLoading) {
    return <MentionPanelLoading>Loading collaborators…</MentionPanelLoading>;
  }

  return undefined;
}

const UserMentionDropdown = ({
  users,
  query,
  selectedIndex,
  onSelect,
  onClose,
  onHover,
  position = 'below',
  isLoading = false,
  loadFailed = false,
  onRetry,
}: UserMentionDropdownProps) => {
  const emptyMessage = query
    ? `No collaborators match “${query}”`
    : 'No collaborators';

  return (
    <MentionDropdownBase
      items={users}
      emptyMessage={emptyMessage}
      headerText="Collaborators"
      selectedIndex={selectedIndex}
      onClose={onClose}
      onHighlight={onHover}
      position={position}
      state={getUsersState(isLoading, loadFailed, onRetry)}
      keyExtractor={(user) => user.id}
      renderItem={(user) => ({
        label: (
          <EntityRow
            layout="row"
            image={
              <Avatar
                name={user.name}
                email={user.email || null}
                {...getAvatarImage(user)}
              />
            }
            title={user.name}
          />
        ),
        onPick: () => onSelect(user),
      })}
    />
  );
};

export default UserMentionDropdown;
