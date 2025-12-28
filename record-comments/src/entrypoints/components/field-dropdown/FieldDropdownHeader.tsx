import type { MutableRefObject, ReactNode } from 'react';
import styles from '@styles/comment.module.css';

type FieldDropdownHeaderProps = {
  title: string;
  onBack: () => void;
  justClickedInsideRef: MutableRefObject<boolean>;
};

const BackIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <title>Go back</title>
    <path
      fillRule="evenodd"
      d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"
    />
  </svg>
);

export function FieldDropdownHeader({
  title,
  onBack,
  justClickedInsideRef,
}: FieldDropdownHeaderProps): ReactNode {
  return (
    <div className={styles.mentionHeader}>
      <button
        type="button"
        className={styles.mentionBackButton}
        onMouseDown={(e) => {
          e.preventDefault();
          justClickedInsideRef.current = true;
          onBack();
        }}
      >
        <BackIcon />
      </button>
      {title}
    </div>
  );
}

export default FieldDropdownHeader;
