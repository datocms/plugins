import { LoadMoreChevron } from 'datocms-react-ui/Chevron';
import RawButton from 'datocms-react-ui/RawButton';
import { memo } from 'react';
import styles from './LoadMoreButton.module.css';

type LoadMoreButtonProps = {
  /** What the button shows next: "Load more comments" */
  label: string;
  onClick: () => void;
};

/** The control at the end of a list that shows its next items */
export const LoadMoreButton = memo(function LoadMoreButton({
  label,
  onClick,
}: LoadMoreButtonProps) {
  return (
    <RawButton className={styles.root} onClick={onClick}>
      <LoadMoreChevron />
      {label}
    </RawButton>
  );
});
