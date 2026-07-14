import type { ReactNode } from 'react';
import styles from './CatalogProductCard.module.css';

export type CatalogProductCardProps = {
  title: string;
  identity: string;
  detail?: string;
  imageUrl?: string | null;
  price?: string | null;
  available?: boolean | null;
  hasStock?: boolean | null;
  selected?: boolean;
  actionLabel: string;
  actionExpanded?: boolean;
  actionControls?: string;
  onAction: () => void;
  children?: ReactNode;
};

function availabilityLabel(
  available: boolean | null | undefined,
  hasStock: boolean | null | undefined,
) {
  if (available === false) {
    return 'Unavailable';
  }

  if (hasStock === false) {
    return 'Out of stock';
  }

  if (available === true && hasStock === true) {
    return 'Available';
  }

  return null;
}

export default function CatalogProductCard({
  title,
  identity,
  detail,
  imageUrl,
  price,
  available,
  hasStock,
  selected = false,
  actionLabel,
  actionExpanded,
  actionControls,
  onAction,
  children,
}: CatalogProductCardProps) {
  const status = availabilityLabel(available, hasStock);

  return (
    <article
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      data-selected={selected || undefined}
    >
      <div className={styles.summary}>
        <div className={styles.media} aria-hidden="true">
          {imageUrl ? (
            <img src={imageUrl} alt="" loading="lazy" />
          ) : (
            <span>No image</span>
          )}
        </div>

        <div className={styles.content}>
          <h3>{title}</h3>
          <div className={styles.identity}>{identity}</div>
          {detail && <div className={styles.detail}>{detail}</div>}
          <div className={styles.meta}>
            {status && (
              <span
                className={
                  status === 'Available' ? styles.positive : styles.warning
                }
              >
                {status}
              </span>
            )}
            {price && <span className={styles.price}>{price}</span>}
          </div>
        </div>

        <button
          type="button"
          className={styles.action}
          aria-pressed={actionExpanded === undefined ? selected : undefined}
          aria-expanded={actionExpanded}
          aria-controls={
            actionExpanded === undefined ? undefined : actionControls
          }
          onClick={onAction}
        >
          {actionLabel}
        </button>
      </div>
      {(children || actionExpanded !== undefined) && (
        <div
          id={actionControls}
          className={styles.children}
          hidden={actionExpanded === false}
        >
          {children}
        </div>
      )}
    </article>
  );
}
