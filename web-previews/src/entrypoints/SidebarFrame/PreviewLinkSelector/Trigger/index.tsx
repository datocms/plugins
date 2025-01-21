import { faCaretDown, faCaretUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { PreviewLink } from '../../../../types';
import styles from './styles.module.css';

type Props = {
  open: boolean;
  onClick: () => void;
  currentPreviewLink: PreviewLink | undefined;
};

export function Trigger({ open, onClick, currentPreviewLink }: Props) {
  return (
    <button type="button" onClick={onClick} className={styles.root}>
      {currentPreviewLink ? (
        <span className={styles.previewLink}>
          <span className={styles.title}>{currentPreviewLink.label}</span>
          <span> — {currentPreviewLink.url}</span>
        </span>
      ) : (
        <span className={styles.previewLink}>Please select a preview...</span>
      )}
      <FontAwesomeIcon
        icon={open ? faCaretUp : faCaretDown}
        className={styles.icon}
      />
    </button>
  );
}
