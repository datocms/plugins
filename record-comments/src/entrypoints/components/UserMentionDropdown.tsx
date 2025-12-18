import { useRef } from 'react';
import type { UserInfo } from '../hooks/useMentions';
import { useScrollSelectedIntoView, useClickOutside } from '../hooks/useDropdown';
import styles from '../styles/comment.module.css';

type UserMentionDropdownProps = {
  users: UserInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (user: UserInfo) => void;
  onClose: () => void;
};

const UserMentionDropdown = ({
  users,
  query,
  selectedIndex,
  onSelect,
  onClose,
}: UserMentionDropdownProps) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useScrollSelectedIntoView(selectedRef, selectedIndex);
  useClickOutside(dropdownRef, onClose);

  if (users.length === 0) {
    return (
      <div ref={dropdownRef} className={styles.mentionDropdown}>
        <div className={styles.mentionEmpty}>
          {query ? `No users matching "${query}"` : 'No users available'}
        </div>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={styles.mentionDropdown}>
      <div className={styles.mentionHeader}>People</div>
      <div className={styles.mentionList}>
        {users.map((user, index) => (
          <button
            key={user.id}
            ref={index === selectedIndex ? selectedRef : null}
            type="button"
            className={`${styles.mentionOption} ${index === selectedIndex ? styles.mentionOptionSelected : ''}`}
            onMouseDown={(e) => {
              // Prevent blur on textarea
              e.preventDefault();
              onSelect(user);
            }}
            onMouseEnter={() => {
              // Visual feedback on hover is handled by CSS,
              // selectedIndex is controlled by keyboard
            }}
          >
            {user.avatarUrl && (
              <img 
                src={user.avatarUrl} 
                alt="" 
                className={styles.mentionUserAvatar}
              />
            )}
            <span className={styles.mentionUserName}>{user.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default UserMentionDropdown;

