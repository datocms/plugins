import { faAnglesDown } from '@fortawesome/free-solid-svg-icons';
import { Spinner } from 'datocms-react-ui';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { VARIANT_PAGE_SIZE } from '../../constants';
import { notVisibleMessage } from '../../lib/fieldValue';
import { pluralize } from '../../lib/format';
import {
  filterableOptions,
  filterVariantsByOptions,
  variantDisabledReason,
} from '../../lib/pickerSearch';
import { describeError, type ShopifyClient } from '../../lib/shopifyClient';
import type {
  ProductOption,
  ProductSummary,
  ShopifyNode,
  VariantSummary,
} from '../../types';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import Callout from '../shared/Callout';
import { useLoadMoreFocus, useRetryFocus } from './useKeepFocus';
import { usePagedQuery } from './usePagedQuery';
import styles from './VariantPanel.module.css';
import { lockedState } from './ResultItems';
import { VariantHeader, VariantList, VariantRow } from './VariantRows';

type VariantsMeta = { variantsCount: number; options: ProductOption[] };

class ProductNotVisibleError extends Error {
  constructor() {
    super(notVisibleMessage('product'));
  }
}

function useProductVariants(
  client: ShopifyClient,
  contextKey: string,
  productId: string,
) {
  return usePagedQuery<VariantSummary, VariantsMeta>(
    `variants:${contextKey}:${productId}`,
    async (after, signal) => {
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

function errorMessage(error: unknown): string {
  return error instanceof ProductNotVisibleError
    ? error.message
    : describeError(error);
}

type OptionChipsProps = {
  options: ProductOption[];
  chosen: Record<string, string>;
  onChange: (chosen: Record<string, string>) => void;
};

/** Narrow a long variant list by option values (Color: Black). */
function OptionChips({ options, chosen, onChange }: OptionChipsProps) {
  const toggle = (name: string, value: string) => {
    const others = Object.fromEntries(
      Object.entries(chosen).filter(([key]) => key !== name),
    );
    onChange(chosen[name] === value ? others : { ...others, [name]: value });
  };
  return (
    <div className={styles.options}>
      {options.map((option) => (
        <div
          key={option.name}
          className={styles.optionGroup}
          role="group"
          aria-label={option.name}
        >
          <span className={styles.optionName}>{option.name}</span>
          {option.optionValues.map(({ name: value }) => (
            <button
              key={value}
              type="button"
              className={styles.optionChip}
              aria-pressed={chosen[option.name] === value}
              onClick={() => toggle(option.name, value)}
            >
              {value}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export type VariantPanelProps = {
  client: ShopifyClient;
  contextKey: string;
  product: ProductSummary;
  panelId: string;
  ownerKey: string;
  locale: string;
  inventory: boolean;
  multiple: boolean;
  isSelected: (node: ShopifyNode) => boolean;
  /** Already in the field (Replace): shown selected, and can't be picked. */
  isUnavailable: (node: ShopifyNode) => boolean;
  disabledReason: string | null;
  /** Why sold-out variants can't be picked right now ("Available for sale"), or null. */
  soldOutReason: string | null;
  onPick: (variant: VariantSummary) => void;
  /** Loaded variants, so selected entries without a node can use them. */
  onLoaded?: (variants: readonly VariantSummary[]) => void;
};

function PanelHeader({
  product,
  count,
  shown,
}: {
  product: ProductSummary;
  count: number | null;
  shown: number | null;
}) {
  const parts = [
    count !== null ? pluralize(count, 'variant') : null,
    shown !== null ? `${shown} shown` : null,
  ].filter(Boolean);
  return (
    <div className={styles.header}>
      <span className={styles.title}>{product.title}</span>
      {parts.length > 0 && (
        <span className={styles.count}>{parts.join(' · ')}</span>
      )}
    </div>
  );
}

function RetryCallout({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Callout
      tone="danger"
      role="alert"
      className={styles.callout}
      actions={
        <Button buttonSize="xxs" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      <p>{errorMessage(error)}</p>
    </Callout>
  );
}

type VariantsQuery = ReturnType<typeof useProductVariants>;

function VariantTable({
  props,
  rows,
}: {
  props: VariantPanelProps;
  rows: VariantSummary[];
}) {
  const { product } = props;
  return (
    <div className={styles.table}>
      <VariantHeader multiple={props.multiple} />
      {rows.length === 0 ? (
        <p className={styles.empty}>No variants match these options</p>
      ) : (
        <VariantList
          ownerKey={props.ownerKey}
          label={`Variants of ${product.title}`}
        >
          {rows.map((variant) => (
            <VariantRow
              key={variant.id}
              variant={variant}
              rovingKey={`variant:${variant.id}`}
              locale={props.locale}
              inventory={props.inventory}
              {...(props.isUnavailable(variant)
                ? lockedState(props.multiple)
                : {
                    selected: props.isSelected(variant),
                    multiple: props.multiple,
                    disabledReason: variantDisabledReason(
                      variant,
                      props.soldOutReason,
                      props.disabledReason,
                    ),
                  })}
              onActivate={() => props.onPick(variant)}
            />
          ))}
        </VariantList>
      )}
    </div>
  );
}

/** Stays enabled while loading, so it keeps focus (see useLoadMoreFocus). */
function LoadMoreVariants({
  query,
  areaRef,
  keepFocus,
}: {
  query: VariantsQuery;
  areaRef: RefObject<HTMLDivElement | null>;
  keepFocus: () => void;
}) {
  if (query.loadMoreError) {
    return (
      <div ref={areaRef}>
        <RetryCallout
          error={query.loadMoreError}
          onRetry={() => {
            keepFocus();
            query.retry();
          }}
        />
      </div>
    );
  }
  if (!query.hasNextPage) return null;
  return (
    <div ref={areaRef} className={styles.more}>
      <Button
        buttonSize="xs"
        leftIcon={<Icon icon={faAnglesDown} />}
        className={query.loadingMore ? styles.moreLoading : undefined}
        onClick={() => {
          if (query.loadingMore) return;
          keepFocus();
          query.loadMore();
        }}
      >
        Load more variants
        {query.loadingMore && <Spinner size={16} />}
      </Button>
    </div>
  );
}

function PanelBody({
  props,
  query,
  rows,
  panelRef,
}: {
  props: VariantPanelProps;
  query: VariantsQuery;
  rows: VariantSummary[];
  panelRef: RefObject<HTMLElement | null>;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const keepLoadMoreFocus = useLoadMoreFocus({
    items: () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? [],
      ),
    area: areaRef,
    loadingMore: query.loadingMore,
  });
  const keepRetryFocus = useRetryFocus({
    root: panelRef,
    status: query.status,
  });
  if (query.status === 'error') {
    return (
      <RetryCallout
        error={query.error}
        onRetry={() => {
          keepRetryFocus();
          query.retry();
        }}
      />
    );
  }
  if (query.status !== 'ready') {
    return (
      <div className={styles.loading}>
        <Spinner size={25} placement="centered" />
      </div>
    );
  }
  return (
    <>
      <VariantTable props={props} rows={rows} />
      <LoadMoreVariants
        query={query}
        areaRef={areaRef}
        keepFocus={keepLoadMoreFocus}
      />
    </>
  );
}

function panelAnnouncement(query: VariantsQuery): string {
  if (query.status === 'loading') return 'Loading variants…';
  return query.loadingMore ? 'Loading more variants…' : '';
}

/** Room kept above the panel when scrolling it into view (a peek at its card). */
const OWNER_PEEK = 96;

/**
 * Scrolls the results so the panel shows, without pushing its top above the
 * results' top (minus a peek at the card that opened it).
 */
function revealPanel(panel: HTMLElement | null): void {
  const scroller = panel?.closest<HTMLElement>('[data-picker-scroll]');
  if (!panel || !scroller) return;
  const box = scroller.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  const overflow = rect.bottom - box.bottom + 12;
  const room = rect.top - box.top - OWNER_PEEK;
  const distance = Math.min(overflow, room);
  if (distance > 0) scroller.scrollTop += distance;
}

/** The inline panel a product opens in variant mode. */
export default function VariantPanel(props: VariantPanelProps) {
  const { client, contextKey, product, panelId } = props;
  const query = useProductVariants(client, contextKey, product.id);
  const { onLoaded } = props;
  const loaded = query.items;
  useEffect(() => {
    if (loaded.length > 0) onLoaded?.(loaded);
  }, [onLoaded, loaded]);
  const panelRef = useRef<HTMLElement>(null);
  const status = query.status;
  useEffect(() => {
    if (status === 'loading' || status === 'ready')
      revealPanel(panelRef.current);
  }, [status]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
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

  return (
    <section
      ref={panelRef}
      id={panelId}
      className={styles.panel}
      aria-label={`Variants of ${product.title}`}
    >
      <PanelHeader
        product={product}
        count={count}
        shown={filtering ? rows.length : null}
      />
      {options.length > 0 && (
        <OptionChips options={options} chosen={chosen} onChange={setChosen} />
      )}
      <span className="dl-sr-only" role="status">
        {panelAnnouncement(query)}
      </span>
      <PanelBody props={props} query={query} rows={rows} panelRef={panelRef} />
    </section>
  );
}
