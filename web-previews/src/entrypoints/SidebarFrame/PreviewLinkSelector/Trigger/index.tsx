import { faCaretDown, faCaretUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { PreviewLinkWithFrontend } from '../../../../types';
import { displayPath } from '../../../../utils/urls';
import styles from './styles.module.css';

type Props = {
  open: boolean;
  onClick: () => void;
  currentPreviewLink: PreviewLinkWithFrontend | undefined;
  /** Prefix the label with the frontend name (useful with several frontends) */
  showFrontendName: boolean;
  /** Nothing else to pick: no caret, not clickable */
  disabled?: boolean;
};

export function Trigger({
  open,
  onClick,
  currentPreviewLink,
  showFrontendName,
  disabled,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={styles.root}
    >
      {currentPreviewLink ? (
        <span className={styles.previewLink} title={currentPreviewLink.url}>
          {showFrontendName && (
            <span className={styles.frontend}>
              {currentPreviewLink.frontendName} ·{' '}
            </span>
          )}
          <span className={styles.title}>{currentPreviewLink.label}</span>
          <span>
            {' — '}
            <span className={styles.host}>
              {new URL(currentPreviewLink.url).host}
            </span>
            {displayPath(currentPreviewLink.url)}
          </span>
        </span>
      ) : (
        <span className={styles.previewLink}>Please select a preview...</span>
      )}
      {!disabled && (
        <FontAwesomeIcon
          icon={open ? faCaretUp : faCaretDown}
          className={styles.icon}
        />
      )}
    </button>
  );
}
