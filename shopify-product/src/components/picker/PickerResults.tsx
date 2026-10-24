import {
  Table,
  useInMemoryTableLayout,
  useLocalStorageTableLayout,
} from 'datocms-react-ui/Table';
import { BarcodeIcon } from '../../icons';
import type { SkuMatch } from '../../lib/shopifyClient';
import type {
  CollectionSummary,
  ProductSummary,
  ShopifyNode,
  VariantSummary,
} from '../../types';
import {
  COLLECTION_COLUMNS,
  COLLECTION_LAYOUT,
  CollectionCard,
  ITEM_PROPS,
  type ItemEnv,
  type ItemNote,
  type ItemSelectionState,
  lockedState,
  PRODUCT_COLUMNS,
  PRODUCT_COLUMNS_STORAGE_KEY,
  PRODUCT_LAYOUT,
  ProductCard,
  resultRow,
  rowBehavior,
} from './ResultItems';
import { ItemGrid, ResultSection } from './ResultsPane';
import styles from './ResultsPane.module.css';
import VariantPanel from './VariantPanel';
import { ProductTreeRows, VariantTable } from './VariantRows';

export type { ItemEnv } from './ResultItems';

const ALWAYS_VISIBLE = { alwaysVisible: true };

function selectionState(env: ItemEnv, node: ShopifyNode): ItemSelectionState {
  if (env.isUnavailable(node)) return lockedState(env.multiple);
  return {
    selected: env.isSelected(node),
    multiple: env.multiple,
    disabledReason: env.disabledReason,
    stale: env.stale,
  };
}

const panelIdFor = (prefix: string, product: ProductSummary) =>
  `shopify-picker-${prefix}-variants-${product.id.replace(/\D/g, '')}`;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

type ProductListProps = {
  env: ItemEnv;
  products: ProductSummary[];
  /** Unique per section: the IDs of the variant panels use it. */
  prefix: string;
  /** Per product ID: the code that matched (SKU or barcode). */
  notes?: ReadonlyMap<string, ItemNote>;
};

/** Grid view: cards; in variant mode a card opens a panel of variants. */
function ProductGrid({ env, products, prefix, notes }: ProductListProps) {
  const variantMode = env.kind === 'variant';
  return (
    <ItemGrid
      items={products}
      expandedId={variantMode ? env.expandedId : null}
      renderItem={(product) => {
        const variantCount = product.variantsCount?.count ?? 0;
        const expandable = variantMode && variantCount !== 1;
        const selectedVariants = variantMode
          ? env.selectedVariants(product.id)
          : 0;
        const base = selectionState(env, product);
        return (
          <ProductCard
            key={product.id}
            product={product}
            state={
              variantMode
                ? { ...base, selected: !expandable && selectedVariants > 0 }
                : base
            }
            hasSelection={env.hasSelection}
            locale={env.locale}
            inventory={env.inventory}
            selectedVariants={expandable ? selectedVariants : 0}
            note={notes?.get(product.id) ?? null}
            expandable={
              expandable
                ? {
                    expanded: env.expandedId === product.id,
                    panelId: panelIdFor(prefix, product),
                  }
                : null
            }
            busy={env.pendingId === product.id}
            onActivate={() => env.activateProduct(product)}
          />
        );
      }}
      renderPanel={(product) => (
        <VariantPanel
          key={`panel:${product.id}`}
          env={env}
          product={product}
          panelId={panelIdFor(prefix, product)}
        />
      )}
    />
  );
}

function ProductTableRow({
  env,
  product,
  note,
}: {
  env: ItemEnv;
  product: ProductSummary;
  note: ItemNote | null;
}) {
  const state = selectionState(env, product);
  return (
    <Table.Row
      row={resultRow(product, env, { note, inField: state.locked === true })}
      {...rowBehavior(state, () => env.pick(product))}
      wrapperProps={ITEM_PROPS}
    />
  );
}

/**
 * List view: a table of products. In variant mode it's a tree: a product
 * with several variants opens them under it.
 */
function ProductTable({ env, products, notes }: ProductListProps) {
  const [layout, setLayout] = useLocalStorageTableLayout(
    PRODUCT_COLUMNS_STORAGE_KEY,
    PRODUCT_LAYOUT,
  );
  const variantMode = env.kind === 'variant';
  return (
    <Table
      columns={PRODUCT_COLUMNS}
      layout={layout}
      onLayoutChange={setLayout}
      className={styles.table}
      checkboxes={env.multiple ? ALWAYS_VISIBLE : undefined}
      tree={variantMode}
    >
      <Table.Header />
      <Table.Body>
        {products.map((product) =>
          variantMode ? (
            <ProductTreeRows
              key={product.id}
              env={env}
              product={product}
              note={notes?.get(product.id) ?? null}
            />
          ) : (
            <ProductTableRow
              key={product.id}
              env={env}
              product={product}
              note={notes?.get(product.id) ?? null}
            />
          ),
        )}
      </Table.Body>
    </Table>
  );
}

/** Products as cards or as a table, as the editor chose. */
export function ProductList(props: ProductListProps) {
  return props.env.view === 'list' ? (
    <ProductTable {...props} />
  ) : (
    <ProductGrid {...props} />
  );
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

function CollectionTable({
  env,
  collections,
}: {
  env: ItemEnv;
  collections: CollectionSummary[];
}) {
  const [layout, setLayout] = useInMemoryTableLayout(COLLECTION_LAYOUT);
  return (
    <Table
      columns={COLLECTION_COLUMNS}
      layout={layout}
      onLayoutChange={setLayout}
      className={styles.table}
      checkboxes={env.multiple ? ALWAYS_VISIBLE : undefined}
    >
      <Table.Header />
      <Table.Body>
        {collections.map((collection) => {
          const state = selectionState(env, collection);
          return (
            <Table.Row
              key={collection.id}
              row={resultRow(collection, env, {
                inField: state.locked === true,
              })}
              {...rowBehavior(state, () => env.pick(collection))}
              wrapperProps={ITEM_PROPS}
            />
          );
        })}
      </Table.Body>
    </Table>
  );
}

export function CollectionList({
  env,
  collections,
}: {
  env: ItemEnv;
  collections: CollectionSummary[];
}) {
  if (env.view === 'list') {
    return <CollectionTable env={env} collections={collections} />;
  }
  const withMedia = collections.some((collection) => collection.image);
  return (
    <ItemGrid
      items={collections}
      renderItem={(collection) => (
        <CollectionCard
          key={collection.id}
          collection={collection}
          state={selectionState(env, collection)}
          hasSelection={env.hasSelection}
          withMedia={withMedia}
          onActivate={() => env.pick(collection)}
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// SKU and barcode matches
// ---------------------------------------------------------------------------

const SKU_TITLE = 'SKU and barcode matches';

/** Per product: the SKU (or barcode) of its first matching variant. */
function matchedCodes(matches: SkuMatch[]): Map<string, ItemNote> {
  const codes = new Map<string, ItemNote>();
  for (const { product, variants } of matches) {
    const variant = variants[0];
    const sku = variant?.sku?.trim();
    const barcode = variant?.barcode?.trim();
    if (sku) codes.set(product.id, { label: 'SKU', code: sku });
    else if (barcode)
      codes.set(product.id, { label: 'Barcode', code: barcode });
  }
  return codes;
}

/** SKU and barcode hits, pinned above the results. */
export function SkuMatches({
  env,
  matches,
}: {
  env: ItemEnv;
  matches: SkuMatch[];
}) {
  if (matches.length === 0) return null;
  const icon = <BarcodeIcon />;
  if (env.kind === 'variant') {
    // The variants themselves, in both views: they are what gets picked.
    const variants: VariantSummary[] = matches.flatMap(
      (match) => match.variants,
    );
    return (
      <ResultSection title={SKU_TITLE} icon={icon} pinned>
        <VariantTable env={env} variants={variants} showProduct />
      </ResultSection>
    );
  }
  return (
    <ResultSection title={SKU_TITLE} icon={icon} pinned>
      <ProductList
        env={env}
        products={matches.map((match) => match.product)}
        prefix="sku"
        notes={matchedCodes(matches)}
      />
    </ResultSection>
  );
}
