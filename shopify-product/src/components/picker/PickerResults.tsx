import { faBarcode } from '@fortawesome/free-solid-svg-icons';
import { variantDisabledReason } from '../../lib/pickerSearch';
import type { SkuMatch } from '../../lib/shopifyClient';
import type {
  CollectionSummary,
  ProductSummary,
  ShopifyKind,
  ShopifyNode,
  VariantSummary,
} from '../../types';
import { Icon } from '../../ui/Icon';
import {
  CollectionItem,
  type ItemNote,
  type ItemSelectionState,
  ListHeader,
  lockedState,
  ProductItem,
} from './ResultItems';
import { ItemCollection, Section } from './ResultsPane';
import VariantPanel from './VariantPanel';
import { VariantHeader, VariantList, VariantRow } from './VariantRows';
import type { PickerView } from './usePickerView';
import type { ShopifyClient } from '../../lib/shopifyClient';

/** Everything an item needs to render and act, shared by every section. */
export type ItemEnv = {
  kind: ShopifyKind;
  view: PickerView;
  locale: string;
  inventory: boolean;
  multiple: boolean;
  client: ShopifyClient;
  contextKey: string;
  /** Why unselected items can't be picked (the selection is full), or null. */
  disabledReason: string | null;
  /** Variant mode: why sold-out variants can't be picked right now, or null. */
  soldOutReason: string | null;
  isSelected: (node: ShopifyNode) => boolean;
  /** Already in the field (Replace): shown selected, and can't be picked. */
  isUnavailable: (node: ShopifyNode) => boolean;
  selectedVariants: (productId: string) => number;
  expandedId: string | null;
  pendingId: string | null;
  pick: (node: ShopifyNode) => void;
  /** Gives selected entries without a node the matching loaded nodes. */
  hydrate: (nodes: readonly ShopifyNode[]) => void;
  activateProduct: (product: ProductSummary) => void;
};

function selectionState(env: ItemEnv, node: ShopifyNode): ItemSelectionState {
  if (env.isUnavailable(node)) return lockedState(env.multiple);
  return {
    selected: env.isSelected(node),
    multiple: env.multiple,
    disabledReason: env.disabledReason,
  };
}

/** A variant row: locked, else sold out or the selection is full. */
function variantState(
  env: ItemEnv,
  variant: VariantSummary,
): ItemSelectionState {
  const state = selectionState(env, variant);
  if (state.locked) return state;
  return {
    ...state,
    disabledReason: variantDisabledReason(
      variant,
      env.soldOutReason,
      env.disabledReason,
    ),
  };
}

const panelIdFor = (prefix: string, product: ProductSummary) =>
  `shopify-picker-${prefix}-variants-${product.id.replace(/\D/g, '')}`;

function productItemProps(
  env: ItemEnv,
  product: ProductSummary,
  prefix: string,
) {
  const isVariantMode = env.kind === 'variant';
  const variantCount = product.variantsCount?.count ?? 0;
  const expandable = isVariantMode && variantCount !== 1;
  const selectedVariants = isVariantMode ? env.selectedVariants(product.id) : 0;
  const base = selectionState(env, product);
  return {
    ...base,
    selected: isVariantMode
      ? !expandable && selectedVariants > 0
      : base.selected,
    product,
    view: env.view,
    rovingKey: `${prefix}:${product.id}`,
    locale: env.locale,
    inventory: env.inventory,
    selectedVariants,
    busy: env.pendingId === product.id,
    expandable: expandable
      ? {
          expanded: env.expandedId === product.id,
          panelId: panelIdFor(prefix, product),
        }
      : null,
    chevronColumn: isVariantMode,
    onActivate: () => env.activateProduct(product),
  };
}

function listColumns(kind: ShopifyKind) {
  return {
    sku: kind !== 'collection',
    variants: 'Variants',
    price: true,
    availability: kind !== 'collection',
  };
}

type ProductListProps = {
  env: ItemEnv;
  products: ProductSummary[];
  label: string;
  /** Roving-key prefix, unique per section. */
  prefix: string;
  /** Per product ID: the code that matched (SKU or barcode). */
  notes?: ReadonlyMap<string, ItemNote>;
};

/** Products as cards or rows; in variant mode a product opens its variants. */
export function ProductList({
  env,
  products,
  label,
  prefix,
  notes,
}: ProductListProps) {
  return (
    <ItemCollection
      items={products}
      view={env.view}
      label={label}
      header={
        <ListHeader
          columns={listColumns(env.kind)}
          withCheck={env.multiple}
          withChevron={env.kind === 'variant'}
        />
      }
      expandedId={env.kind === 'variant' ? env.expandedId : null}
      renderItem={(product) => (
        <ProductItem
          key={product.id}
          {...productItemProps(env, product, prefix)}
          note={notes?.get(product.id) ?? null}
        />
      )}
      renderPanel={(product) => (
        <VariantPanel
          key={`panel:${product.id}`}
          client={env.client}
          contextKey={env.contextKey}
          product={product}
          panelId={panelIdFor(prefix, product)}
          ownerKey={`${prefix}:${product.id}`}
          locale={env.locale}
          inventory={env.inventory}
          multiple={env.multiple}
          isSelected={env.isSelected}
          isUnavailable={env.isUnavailable}
          disabledReason={env.disabledReason}
          soldOutReason={env.soldOutReason}
          onPick={env.pick}
          onLoaded={env.hydrate}
        />
      )}
    />
  );
}

export function CollectionList({
  env,
  collections,
}: {
  env: ItemEnv;
  collections: CollectionSummary[];
}) {
  const withMedia = collections.some((collection) => collection.image);
  return (
    <ItemCollection
      items={collections}
      view={env.view}
      label="Collections"
      header={
        <ListHeader columns={{}} withCheck={env.multiple} withChevron={false} />
      }
      renderItem={(collection) => (
        <CollectionItem
          key={collection.id}
          {...selectionState(env, collection)}
          collection={collection}
          view={env.view}
          withMedia={withMedia}
          rovingKey={`collection:${collection.id}`}
          onActivate={() => env.pick(collection)}
        />
      )}
    />
  );
}

const SKU_TITLE = 'Exact SKU / barcode matches';

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
  const icon = <Icon icon={faBarcode} />;
  if (env.kind === 'variant') {
    const variants: VariantSummary[] = matches.flatMap(
      (match) => match.variants,
    );
    return (
      <Section title={SKU_TITLE} icon={icon}>
        <div>
          <VariantHeader multiple={env.multiple} />
          <VariantList label={SKU_TITLE}>
            {variants.map((variant) => (
              <VariantRow
                key={variant.id}
                {...variantState(env, variant)}
                variant={variant}
                rovingKey={`sku-variant:${variant.id}`}
                locale={env.locale}
                inventory={env.inventory}
                showProduct
                onActivate={() => env.pick(variant)}
              />
            ))}
          </VariantList>
        </div>
      </Section>
    );
  }
  return (
    <Section title={SKU_TITLE} icon={icon}>
      <ProductList
        env={env}
        products={matches.map((match) => match.product)}
        label={SKU_TITLE}
        prefix="sku"
        notes={matchedCodes(matches)}
      />
    </Section>
  );
}
