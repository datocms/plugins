import styles from '@styles/comment.module.css';
import type { ReactNode } from 'react';

type MentionDropdownOptionContentProps = {
  leading: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
};

export function MentionDropdownOptionContent({
  leading,
  title,
  description,
  trailing,
}: MentionDropdownOptionContentProps) {
  return (
    <>
      <span className={styles.mentionOptionMain}>
        <span className={styles.mentionOptionLeading}>{leading}</span>
        <span className={styles.mentionOptionCopy}>
          <span className={styles.mentionOptionTitle}>{title}</span>
          {description && (
            <span className={styles.mentionOptionDescription}>
              {description}
            </span>
          )}
        </span>
      </span>
      {trailing && (
        <span className={styles.mentionOptionTrailing}>{trailing}</span>
      )}
    </>
  );
}
