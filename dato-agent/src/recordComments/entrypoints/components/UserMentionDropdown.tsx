import type { UserInfo } from '@hooks/useMentions';
import styles from '@styles/comment.module.css';
import { cn } from '@/utils/cn';
import { UserMentionIcon } from './Icons';
import { MentionDropdownBase } from './shared/MentionDropdownBase';
import { MentionDropdownOptionContent } from './shared/MentionDropdownOptionContent';

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
  onSelectedIndexChange?: (index: number) => void;
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
  onSelectedIndexChange,
}: UserMentionDropdownProps) => {
  const emptyMessage = isLoading
    ? 'Loading people…'
    : errorMessage ||
      (query ? `No users matching "${query}"` : 'No users available');

  const emptyAction =
    errorMessage && onRetry ? (
      <button
        className={styles.mentionRetryButton}
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
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
      emptyAction={emptyAction}
      statusAction={errorMessage ? emptyAction : undefined}
      statusMessage={
        isLoading
          ? 'Loading people…'
          : errorMessage
            ? 'Couldn’t refresh people.'
            : undefined
      }
      renderItem={(user, index, isSelected, selectedRef) => (
        <button
          ref={isSelected ? selectedRef : null}
          type="button"
          className={cn(
            styles.mentionOption,
            isSelected && styles.mentionOptionSelected,
          )}
          role="menuitem"
          onMouseDown={(e) => {
            // Prevent blur on textarea
            e.preventDefault();
          }}
          onClick={() => onSelect(user)}
          onMouseEnter={() => onSelectedIndexChange?.(index)}
        >
          <MentionDropdownOptionContent
            description={user.email}
            leading={
              user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className={styles.mentionUserAvatar}
                />
              ) : (
                <span className={styles.mentionUserAvatarFallback}>
                  <UserMentionIcon aria-hidden="true" />
                </span>
              )
            }
            title={user.name}
          />
        </button>
      )}
    />
  );
};

export default UserMentionDropdown;
