import { Button } from 'datocms-react-ui';
import styles from './SelectedReferenceRow.module.css';

export type SelectedReferenceRowProps = {
  title: string;
  identity: string;
  detail?: string | null;
  imageUrl?: string | null;
  unavailable?: boolean;
  warning?: string | null;
  unresolved?: boolean;
  disabled?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onReplace: () => void;
  onRemove: () => void;
};

export default function SelectedReferenceRow({
  title,
  identity,
  detail,
  imageUrl,
  unavailable = false,
  warning,
  unresolved = false,
  disabled = false,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  onReplace,
  onRemove,
}: SelectedReferenceRowProps) {
  return (
    <article className={`${styles.row} ${unresolved ? styles.unresolved : ''}`}>
      <div className={styles.media} aria-hidden="true">
        {imageUrl ? <img src={imageUrl} alt="" /> : <span>Centra</span>}
      </div>
      <div className={styles.content}>
        <div className={styles.title}>{title}</div>
        <div className={styles.identity}>{identity}</div>
        {detail && <div className={styles.detail}>{detail}</div>}
        {unavailable && <div className={styles.warning}>Unavailable</div>}
        {warning && <div className={styles.warning}>{warning}</div>}
      </div>
      <div className={styles.actions}>
        {onMoveUp && (
          <Button
            buttonSize="xxs"
            disabled={disabled || !canMoveUp}
            onClick={onMoveUp}
          >
            <span aria-hidden="true">↑</span>
            <span className={styles.srOnly}>Move up</span>
          </Button>
        )}
        {onMoveDown && (
          <Button
            buttonSize="xxs"
            disabled={disabled || !canMoveDown}
            onClick={onMoveDown}
          >
            <span aria-hidden="true">↓</span>
            <span className={styles.srOnly}>Move down</span>
          </Button>
        )}
        <Button buttonSize="xxs" disabled={disabled} onClick={onReplace}>
          Replace
        </Button>
        <Button
          buttonSize="xxs"
          buttonType="negative"
          disabled={disabled}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </article>
  );
}
