import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { LoadMoreChevron } from 'datocms-react-ui/Chevron';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import PillTrigger from 'datocms-react-ui/Dropdown/triggers/PillTrigger';
import { Table, useInMemoryTableLayout } from 'datocms-react-ui/Table';
import {
  type ReactNode,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { VARIANT_PAGE_SIZE } from '../../constants';
import { CircleExclamationIcon } from '../../icons';
import { notVisibleMessage } from '../../lib/fieldValue';
import { formatCount, pluralize } from '../../lib/format';
import {
  filterableOptions,
  filterVariantsByOptions,
  variantDisabledReason,
} from '../../lib/pickerSearch';
import { describeError, type ShopifyClient } from '../../lib/shopifyClient';
import type {
  ProductOption,
  ProductSummary,
  VariantSummary,
} from '../../types';
import {
  ITEM_PROPS,
  type ItemEnv,
  type ItemNote,
  type ItemSelectionState,
  isItemDisabled,
  lockedState,
  resultRow,
  rowBehavior,
  VARIANT_COLUMNS,
  VARIANT_LAYOUT,
} from './ResultItems';
import styles from './ResultsPane.module.css';
import { focusTargets, useLoadMoreFocus, useRetryFocus } from './useKeepFocus';
import { usePagedQuery } from './usePagedQuery';
import { useTriggerFocus } from './useTriggerFocus';

// ---------------------------------------------------------------------------
// The variants of one product
// ---------------------------------------------------------------------------

type VariantsMeta = { variantsCount: number; options: ProductOption[] };

class ProductNotVisibleError extends Error {
  constructor() {
    super(notVisibleMessage('product'));
  }
}

export function variantsErrorMessage(error: unknown): string {
  return error instanceof ProductNotVisibleError
    ? error.message
    : describeError(error);
}

/** Pages of a product's variants; `productId` null loads nothing. */
function useProductVariants(
  client: ShopifyClient,
  contextKey: string,
  productId: string | null,
) {
  return usePagedQuery<VariantSummary, VariantsMeta>(
    productId === null ? null : `variants:${contextKey}:${productId}`,
    async (after, signal) => {
      if (productId === null) throw new ProductNotVisibleError();
      const result = await client.productVariants(
        { productId, first: VARIANT_PAGE_SIZE, after },
        { signal },
      );
      if (!result) throw new ProductNotVisibleError();
      return {
        page: result.page,
        meta: { variantsCount: result.variantsCount, options: result.options },
      };
    },
  );
}

/**
 * The variants a product opens: the loaded pages, the option values chosen
 * to narrow them (`Color: Black`), and the rows that match.
 */
export function useVariants(
  env: ItemEnv,
  product: ProductSummary,
  enabled: boolean,
) {
  const query = useProductVariants(
    env.client,
    env.contextKey,
    enabled ? product.id : null,
  );
  // Selected entries without a node pick up the loaded variants.
  const { hydrate } = env;
  const loaded = query.items;
  useEffect(() => {
    if (loaded.length > 0) hydrate(loaded);
  }, [hydrate, loaded]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!enabled) setChosen({});
  }, [enabled]);
  const count =
    query.meta?.variantsCount ?? product.variantsCount?.count ?? null;
  const options = useMemo(
    () => filterableOptions(query.meta?.options ?? [], count ?? 0),
    [query.meta, count],
  );
  const rows = useMemo(
    () => filterVariantsByOptions(query.items, chosen),
    [query.items, chosen],
  );
  const filtering = Object.keys(chosen).length > 0;
  return { query, chosen, setChosen, count, options, rows, filtering };
}

export type Variants = ReturnType<typeof useVariants>;

/**
 * `"12 variants"`, or `"4 of 12 variants"` while option filters apply, with
 * the separators of `locale`.
 */
export function variantCountLabel(
  variants: Variants,
  locale: string,
): string | null {
  const { count, filtering, rows } = variants;
  if (count === null) return null;
  const total = pluralize(count, 'variant', 'variants', locale);
  return filtering ? `${formatCount(rows.length, locale)} of ${total}` : total;
}

export function variantsAnnouncement(variants: Variants): string {
  const { query } = variants;
  if (query.status === 'loading') return 'Loading variants…';
  return query.loadingMore ? 'Loading more variants…' : '';
}

/** A variant row: already in the field, else sold out or the selection is full. */
export function variantState(
  env: ItemEnv,
  variant: VariantSummary,
): ItemSelectionState {
  if (env.isUnavailable(variant)) return lockedState(env.multiple);
  return {
    selected: env.isSelected(variant),
    multiple: env.multiple,
    disabledReason: variantDisabledReason(
      variant,
      env.soldOutReason,
      env.disabledReason,
    ),
    stale: env.stale,
  };
}

/**
 * The row's own explanation when it can't be picked for being sold out while
 * "Available for sale" applies: the kit's rows have no disabled reason, and
 * nothing else on screen says why the row is inert.
 */
function soldOutRowReason(
  env: ItemEnv,
  variant: VariantSummary,
  state: ItemSelectionState,
): string | null {
  if (!env.soldOutReason || variant.availableForSale || state.locked) {
    return null;
  }
  return isItemDisabled(state) ? env.soldOutReason : null;
}

// ---------------------------------------------------------------------------
// Option filters
// ---------------------------------------------------------------------------

function OptionFilter({
  option,
  value,
  onChange,
}: {
  option: ProductOption;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { ref, refocus } = useTriggerFocus();
  const choose = (next: string | null) => () => {
    refocus();
    onChange(next);
  };
  return (
    <div ref={ref}>
      <Dropdown
        triggerComponent={PillTrigger}
        label={`${option.name}: ${value ?? 'Any'}`}
        tone={value === null ? 'neutral' : 'soft'}
      >
        {() => (
          <Dropdown.Menu minWidth={180}>
            <Dropdown.Option active={value === null} onPick={choose(null)}>
              Any
            </Dropdown.Option>
            <Dropdown.Separator />
            {option.optionValues.map(({ name }) => (
              <Dropdown.Option
                key={name}
                active={value === name}
                onPick={choose(name)}
              >
                {name}
              </Dropdown.Option>
            ))}
          </Dropdown.Menu>
        )}
      </Dropdown>
    </div>
  );
}

/** Narrows a long list of variants by option values (`Color: Black`). */
export function OptionFilters({ variants }: { variants: Variants }) {
  const { options, chosen, setChosen } = variants;
  const change = (name: string) => (value: string | null) => {
    const others = Object.fromEntries(
      Object.entries(chosen).filter(([key]) => key !== name),
    );
    setChosen(value === null ? others : { ...others, [name]: value });
  };
  return (
    <>
      {options.map((option) => (
        <OptionFilter
          key={option.name}
          option={option}
          value={chosen[option.name] ?? null}
          onChange={change(option.name)}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** The rows of a product's variants carry it, for the focus after Load more. */
const VARIANT_OF_ATTRIBUTE = 'data-picker-variant-of';

const variantOfKey = (product: ProductSummary) =>
  product.id.replace(/\D/g, '') || product.id;

function variantRowsOf(product: ProductSummary): HTMLElement[] {
  return focusTargets(
    document.querySelectorAll<HTMLElement>(
      `[${VARIANT_OF_ATTRIBUTE}="${variantOfKey(product)}"]`,
    ),
  );
}

export function VariantTableRow({
  env,
  variant,
  showProduct = false,
  indentation,
  owner,
}: {
  env: ItemEnv;
  variant: VariantSummary;
  /** SKU matches name the product too. */
  showProduct?: boolean;
  /** Under its product, in the tree of the list view. */
  indentation?: number;
  /** The product whose rows these are, in the tree of the list view. */
  owner?: ProductSummary;
}) {
  const state = variantState(env, variant);
  const row = resultRow(variant, env, {
    inField: state.locked === true,
    showProduct,
    reason: soldOutRowReason(env, variant, state),
  });
  const wrapperProps = owner
    ? { ...ITEM_PROPS, [VARIANT_OF_ATTRIBUTE]: variantOfKey(owner) }
    : ITEM_PROPS;
  return (
    <Table.Row
      row={row}
      {...rowBehavior(state, () => env.pick(variant))}
      firstCell={indentation === undefined ? undefined : { indentation }}
      wrapperProps={wrapperProps}
    />
  );
}

const ALWAYS_VISIBLE = { alwaysVisible: true };

/** Variants as a table: a product's variants, or the SKU matches. */
export function VariantTable({
  env,
  variants,
  showProduct = false,
}: {
  env: ItemEnv;
  variants: VariantSummary[];
  showProduct?: boolean;
}) {
  const [layout, setLayout] = useInMemoryTableLayout(VARIANT_LAYOUT);
  return (
    <Table
      columns={VARIANT_COLUMNS}
      layout={layout}
      onLayoutChange={setLayout}
      className={styles.table}
      checkboxes={env.multiple ? ALWAYS_VISIBLE : undefined}
    >
      <Table.Header />
      <Table.Body>
        {variants.map((variant) => (
          <VariantTableRow
            key={variant.id}
            env={env}
            variant={variant}
            showProduct={showProduct}
          />
        ))}
      </Table.Body>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// The tree of the list view: products, and the variants under the open one
// ---------------------------------------------------------------------------

/** The indentation of the variants under their product. */
const TREE_INDENTATION = 30;

/** A row of the tree that isn't a variant: a message, the filters, Load more. */
function TreeCellRow({
  prefix = null,
  children,
}: {
  prefix?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Table.Row>
      <Table.Cell
        index={0}
        fill
        firstCell={{ indentation: TREE_INDENTATION, prefix }}
      >
        <div className={styles.treeCell}>{children}</div>
      </Table.Cell>
    </Table.Row>
  );
}

/**
 * A failed page of variants, as the grid's panel shows it: the small error
 * state with Try again, in a row of the tree.
 */
function TreeError({
  title,
  error,
  onRetry,
  retryRef,
  areaRef,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
  retryRef?: Ref<HTMLElement>;
  /** Load more's focus area: a failed later page keeps focus in it. */
  areaRef?: Ref<HTMLDivElement>;
}) {
  return (
    <Table.Row>
      <Table.Cell
        index={0}
        fill
        firstCell={{ indentation: TREE_INDENTATION, prefix: null }}
      >
        <div ref={areaRef}>
          <BlankSlate
            placement="section"
            small
            error
            icon={<CircleExclamationIcon />}
            title={title}
            description={variantsErrorMessage(error)}
            actions={
              <Button ref={retryRef} label="Try again" onClick={onRetry} />
            }
          />
        </div>
      </Table.Cell>
    </Table.Row>
  );
}

/** The rows under an open product, in the list view. */
function VariantChildRows({
  env,
  product,
  variants,
}: {
  env: ItemEnv;
  product: ProductSummary;
  variants: Variants;
}) {
  const { query, rows } = variants;
  const areaRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLElement>(null);
  const keepLoadMoreFocus = useLoadMoreFocus({
    items: () => variantRowsOf(product),
    area: areaRef,
    loadingMore: query.loadingMore,
  });
  const keepRetryFocus = useRetryFocus({
    firstItem: () => variantRowsOf(product)[0] ?? null,
    retryButton: retryRef,
    status: query.status,
  });

  if (query.status === 'error') {
    return (
      <TreeError
        title="Couldn't load the variants"
        error={query.error}
        retryRef={retryRef}
        onRetry={() => {
          keepRetryFocus();
          query.retry();
        }}
      />
    );
  }
  // The toggle of the product spins while the first page loads.
  if (query.status !== 'ready') return null;
  const countLabel = variantCountLabel(variants, env.locale);
  return (
    <>
      {variants.options.length > 0 && (
        <TreeCellRow>
          {countLabel && <span className={styles.subtle}>{countLabel}</span>}
          <OptionFilters variants={variants} />
        </TreeCellRow>
      )}
      {rows.length === 0 && (
        <TreeCellRow>
          <span className={styles.subtle}>No variants match these options</span>
        </TreeCellRow>
      )}
      {rows.map((variant) => (
        <VariantTableRow
          key={variant.id}
          env={env}
          variant={variant}
          indentation={TREE_INDENTATION}
          owner={product}
        />
      ))}
      {query.loadMoreError ? (
        <TreeError
          title="Couldn't load more variants"
          error={query.loadMoreError}
          areaRef={areaRef}
          onRetry={() => {
            keepLoadMoreFocus();
            query.retry();
          }}
        />
      ) : (
        query.hasNextPage && (
          <TreeCellRow prefix={<LoadMoreChevron loading={query.loadingMore} />}>
            <div ref={areaRef}>
              {/* Not busy: it keeps focus while the page loads. */}
              <Button
                tone="ghost"
                size="micro"
                label="Load more variants"
                aria-busy={query.loadingMore || undefined}
                onClick={() => {
                  if (query.loadingMore) return;
                  keepLoadMoreFocus();
                  query.loadMore();
                }}
              />
            </div>
          </TreeCellRow>
        )
      )}
    </>
  );
}

/**
 * A product of the list view in variant mode, and its variants under it
 * while it's open. A product with one variant picks it directly.
 */
export function ProductTreeRows({
  env,
  product,
  note,
}: {
  env: ItemEnv;
  product: ProductSummary;
  note: ItemNote | null;
}) {
  const expandable = (product.variantsCount?.count ?? 0) !== 1;
  const open = expandable && env.expandedId === product.id;
  const variants = useVariants(env, product, open);
  const selectedVariants = env.selectedVariants(product.id);
  const state: ItemSelectionState = {
    selected: !expandable && selectedVariants > 0,
    multiple: env.multiple,
    disabledReason: env.disabledReason,
    stale: env.stale,
  };
  const activate = () => env.activateProduct(product);
  return (
    <>
      <Table.Row
        row={resultRow(product, env, { note, selectedVariants })}
        {...rowBehavior(state, activate, {
          expandable: expandable
            ? {
                open,
                onToggle: activate,
                busy: open && variants.query.status === 'loading',
              }
            : undefined,
          busy: env.pendingId === product.id,
        })}
        wrapperProps={ITEM_PROPS}
      />
      {open && (
        <VariantChildRows env={env} product={product} variants={variants} />
      )}
    </>
  );
}
