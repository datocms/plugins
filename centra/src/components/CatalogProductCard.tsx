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
  summaryId?: string;
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
  summaryId,
  onAction,
  children,
}: CatalogProductCardProps) {
  const status = availabilityLabel(available, hasStock);
  const isDrilldown = actionExpanded !== undefined;
  const summaryContent = (
    <>
      <span className={styles.media} aria-hidden="true">
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" />
        ) : (
          <span>No image</span>
        )}
        {!isDrilldown && (
          <span className={styles.selectionMark}>{selected ? '✓' : ''}</span>
        )}
      </span>

      <span className={styles.content}>
        <span className={styles.title} title={title}>
          {title}
        </span>
        <span className={styles.identity} title={identity}>
          {identity}
        </span>
        {detail && (
          <span className={styles.detail} title={detail}>
            {detail}
          </span>
        )}
        <span className={styles.meta}>
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
        </span>
      </span>
    </>
  );

  return (
    <article
      className={`${styles.card} ${selected ? styles.selected : ''} ${
        isDrilldown ? styles.drilldown : ''
      }`}
      data-selected={selected || undefined}
      data-layout={isDrilldown ? 'drilldown' : 'card'}
    >
      {isDrilldown ? (
        <div id={summaryId} className={styles.summary}>
          {summaryContent}
          <button
            type="button"
            className={styles.action}
            aria-expanded={actionExpanded}
            aria-controls={actionControls}
            onClick={onAction}
          >
            {actionLabel}
          </button>
        </div>
      ) : (
        <button
          id={summaryId}
          type="button"
          className={`${styles.summary} ${styles.selectionButton}`}
          aria-label={`${actionLabel} ${title}`}
          aria-pressed={selected}
          onClick={onAction}
        >
          {summaryContent}
          <span className={styles.actionLabel} aria-hidden="true">
            {actionLabel}
          </span>
        </button>
      )}
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
