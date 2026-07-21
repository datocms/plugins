import { Button } from 'datocms-react-ui';
import styles from './SelectedReferenceRow.module.css';

export type SelectedReferenceRowProps = {
  title: string;
  identity: string;
  detail?: string | null;
  imageUrl?: string | null;
  status?: 'Unavailable' | 'Out of stock' | null;
  preorder?: boolean;
  warning?: string | null;
  unresolved?: boolean;
  showIdentity?: boolean;
  disabled?: boolean;
  onReplace: () => void;
  onRemove: () => void;
};

function ReferenceIdentity({
  identity,
  unresolved,
  visible,
}: {
  identity: string;
  unresolved: boolean;
  visible: boolean;
}) {
  if (!visible && !unresolved) return null;

  return (
    <div
      className={`${styles.identity} ${
        unresolved ? styles.identityWarning : ''
      }`}
    >
      {identity}
    </div>
  );
}

export default function SelectedReferenceRow({
  title,
  identity,
  detail,
  imageUrl,
  status,
  preorder = false,
  warning,
  unresolved = false,
  showIdentity = false,
  disabled = false,
  onReplace,
  onRemove,
}: SelectedReferenceRowProps) {
  return (
    <article
      className={`${styles.card} ${unresolved ? styles.unresolved : ''} ${
        disabled ? styles.disabled : ''
      }`}
      aria-label={`${title}: ${identity}`}
    >
      <div className={styles.media}>
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" />
        ) : (
          <span className={styles.noImage} aria-hidden="true">
            Centra
          </span>
        )}

        <div
          className={styles.actions}
          role="group"
          aria-label={`Actions for ${title}`}
        >
          <Button
            className={styles.actionButton}
            buttonSize="xxs"
            buttonType="negative"
            disabled={disabled}
            onClick={onRemove}
          >
            Remove
          </Button>
          <Button
            className={styles.actionButton}
            buttonSize="xxs"
            disabled={disabled}
            onClick={onReplace}
          >
            Replace
          </Button>
        </div>
      </div>

      <div className={styles.caption}>
        <div className={styles.title} title={title}>
          {title}
        </div>
        {detail && (
          <div className={styles.detail} title={detail}>
            {detail}
          </div>
        )}
        <ReferenceIdentity
          identity={identity}
          unresolved={unresolved}
          visible={showIdentity}
        />
        {(status || preorder) && (
          <div className={styles.statuses}>
            {status && <span>{status}</span>}
            {preorder && <span>Preorder</span>}
          </div>
        )}
        {warning && <div className={styles.warning}>{warning}</div>}
      </div>
    </article>
  );
}
