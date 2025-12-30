import type { UserInfo } from '@hooks/useMentions';
import { MentionDropdownBase } from './shared/MentionDropdownBase';
import { cn } from '@/utils/cn';
import styles from '@styles/comment.module.css';

type UserMentionDropdownProps = {
  users: UserInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (user: UserInfo) => void;
  onClose: () => void;
  position?: 'above' | 'below';
};

const UserMentionDropdown = ({
  users,
  query,
  selectedIndex,
  onSelect,
  onClose,
  position = 'below',
}: UserMentionDropdownProps) => {
  const emptyMessage = query ? `No users matching "${query}"` : 'No users available';

  return (
    <MentionDropdownBase
      items={users}
      emptyMessage={emptyMessage}
      headerText="People"
      selectedIndex={selectedIndex}
      onClose={onClose}
      position={position}
      keyExtractor={(user) => user.id}
      renderItem={(user, _index, isSelected, selectedRef) => (
        <button
          ref={isSelected ? selectedRef : null}
          type="button"
          className={cn(styles.mentionOption, isSelected && styles.mentionOptionSelected)}
          onMouseDown={(e) => {
            // Prevent blur on textarea
            e.preventDefault();
            onSelect(user);
          }}
          onClick={() => onSelect(user)}
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
