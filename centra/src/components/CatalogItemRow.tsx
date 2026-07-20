import styles from './CatalogItemRow.module.css';

export type CatalogItemRowProps = {
  title: string;
  itemId: string;
  sku?: string | null;
  gtin?: string | null;
  stockLabel?: string | null;
  preorder?: boolean | null;
  selected?: boolean;
  onSelect: () => void;
};

export default function CatalogItemRow({
  title,
  itemId,
  sku,
  gtin,
  stockLabel,
  preorder,
  selected = false,
  onSelect,
}: CatalogItemRowProps) {
  return (
    <button
      type="button"
      className={`${styles.row} ${selected ? styles.selected : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={styles.check} aria-hidden="true">
        {selected ? '✓' : ''}
      </span>
      <span className={styles.main}>
        <strong>{title}</strong>
        <span className={styles.itemId}>Item {itemId}</span>
      </span>
      <span className={styles.identifiers}>
        {sku && <span>SKU {sku}</span>}
        {gtin && <span>GTIN {gtin}</span>}
      </span>
      <span className={styles.status}>
        {stockLabel && <span>{stockLabel}</span>}
        {preorder && <span>Preorder</span>}
      </span>
    </button>
  );
}
