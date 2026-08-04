import type { UserInfo } from '@hooks/useMentions';
import styles from '@styles/comment.module.css';
import { cn } from '@/utils/cn';
import { MentionDropdownBase } from './shared/MentionDropdownBase';

type UserMentionDropdownProps = {
  users: UserInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (user: UserInfo) => void;
  onClose: () => void;
  position?: 'above' | 'below';
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
};

const UserMentionDropdown = ({
  users,
  query,
  selectedIndex,
  onSelect,
  onClose,
  position = 'below',
  isLoading = false,
  errorMessage = null,
  onRetry,
}: UserMentionDropdownProps) => {
  const emptyMessage = isLoading
    ? 'Loading people…'
    : errorMessage ||
      (query ? `No users matching "${query}"` : 'No users available');

  const searchSlot =
    errorMessage && onRetry ? (
      <button
        className={styles.mentionRetryButton}
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    ) : isLoading && users.length > 0 ? (
      <div aria-live="polite" className={styles.mentionEmpty} role="status">
        Loading people…
      </div>
    ) : undefined;

  return (
    <MentionDropdownBase
      items={users}
      emptyMessage={emptyMessage}
      headerText="People"
      selectedIndex={selectedIndex}
      onClose={onClose}
      position={position}
      keyExtractor={(user) => user.id}
      searchSlot={searchSlot}
      renderItem={(user, _index, isSelected, selectedRef) => (
        <button
          ref={isSelected ? selectedRef : null}
          type="button"
          className={cn(
            styles.mentionOption,
            isSelected && styles.mentionOptionSelected,
          )}
          onMouseDown={(e) => {
            // Prevent blur on textarea
            e.preventDefault();
            onSelect(user);
          }}
        >
          {user.avatarUrl && (
            <img
              src={user.avatarUrl}
              alt={`Avatar for ${user.name}`}
              className={styles.mentionUserAvatar}
            />
          )}
          <span className={styles.mentionUserName}>{user.name}</span>
        </button>
      )}
    />
  );
};

export default UserMentionDropdown;
