import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import EntityRow from 'datocms-react-ui/EntityRow';
import { type RefObject, useEffect, useRef } from 'react';
import {
  CircleExclamationIcon,
  KindIcon,
  MagnifyingGlassIcon,
} from '../../icons';
import type { ProductSummary } from '../../types';
import Thumbnail from '../shared/Thumbnail';
import type { ItemEnv } from './ResultItems';
import styles from './ResultsPane.module.css';
import { scrollParent } from './useInView';
import {
  itemTargets,
  PANEL_ATTRIBUTE,
  useLoadMoreFocus,
  useRetryFocus,
} from './useKeepFocus';
import {
  OptionFilters,
  useVariants,
  type Variants,
  VariantTable,
  variantCountLabel,
  variantsAnnouncement,
  variantsErrorMessage,
} from './VariantRows';

const PANEL_PROPS = { [PANEL_ATTRIBUTE]: '' };

/** The panel's Load more, or the Try again of a page that failed. */
function LoadMoreVariants({
  variants,
  panelRef,
}: {
  variants: Variants;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const { query } = variants;
  const areaRef = useRef<HTMLDivElement>(null);
  const keepFocus = useLoadMoreFocus({
    items: () => itemTargets(panelRef.current),
    area: areaRef,
    loadingMore: query.loadingMore,
  });
  if (!query.loadMoreError && !query.hasNextPage) return null;
  return (
    <div ref={areaRef} className={styles.loadMore}>
      {query.loadMoreError ? (
        <BlankSlate
          placement="section"
          small
          error
          icon={<CircleExclamationIcon />}
          title="Couldn't load more variants"
          description={variantsErrorMessage(query.loadMoreError)}
          actions={
            <Button
              label="Try again"
              onClick={() => {
                keepFocus();
                query.retry();
              }}
            />
          }
        />
      ) : (
        <Button
          label="Load more variants"
          busy={query.loadingMore}
          onClick={() => {
            keepFocus();
            query.loadMore();
          }}
        />
      )}
    </div>
  );
}

function PanelBody({
  env,
  variants,
  panelRef,
}: {
  env: ItemEnv;
  variants: Variants;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const { query, rows } = variants;
  const retryRef = useRef<HTMLElement>(null);
  const keepRetryFocus = useRetryFocus({
    firstItem: () => itemTargets(panelRef.current)[0] ?? null,
    retryButton: retryRef,
    status: query.status,
  });
  if (query.status === 'error') {
    return (
      <BlankSlate
        placement="section"
        small
        error
        icon={<CircleExclamationIcon />}
        title="Couldn't load the variants"
        description={variantsErrorMessage(query.error)}
        actions={
          <Button
            ref={retryRef}
            label="Try again"
            onClick={() => {
              keepRetryFocus();
              query.retry();
            }}
          />
        }
      />
    );
  }
  if (query.status !== 'ready') {
    return (
      <BlankSlate
        placement="section"
        small
        loading
        title="Loading the variants"
      />
    );
  }
  return (
    <>
      {rows.length === 0 ? (
        <BlankSlate
          placement="section"
          small
          icon={<MagnifyingGlassIcon />}
          title="No variants match these options"
        />
      ) : (
        <VariantTable env={env} variants={rows} />
      )}
      <LoadMoreVariants variants={variants} panelRef={panelRef} />
    </>
  );
}

/** Room kept above the panel when scrolling it into view (a peek at its card). */
const OWNER_PEEK = 96;

/**
 * Scrolls the results so the panel shows, without pushing its top above the
 * results' top (minus a peek at the card that opened it).
 */
function revealPanel(panel: HTMLElement | null): void {
  const scroller = scrollParent(panel);
  if (!panel || !scroller) return;
  const box = scroller.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  const overflow = rect.bottom - box.bottom + 12;
  const room = rect.top - box.top - OWNER_PEEK;
  const distance = Math.min(overflow, room);
  if (distance > 0) scroller.scrollTop += distance;
}

/**
 * Variant mode, grid view: the variants a product opens, in a band that
 * spans the grid under the card's row. It names its product, counts the
 * variants, narrows long lists by option and lists them in a table.
 */
export default function VariantPanel({
  env,
  product,
  panelId,
}: {
  env: ItemEnv;
  product: ProductSummary;
  panelId: string;
}) {
  const variants = useVariants(env, product, true);
  const panelRef = useRef<HTMLDivElement>(null);
  const status = variants.query.status;
  useEffect(() => {
    if (status === 'loading' || status === 'ready') {
      revealPanel(panelRef.current);
    }
  }, [status]);
  const countLabel = variantCountLabel(variants, env.locale);

  return (
    <div
      ref={panelRef}
      id={panelId}
      className={styles.panel}
      role="group"
      aria-label={`Variants of ${product.title}`}
      {...PANEL_PROPS}
    >
      <EntityRow
        layout="row"
        image={
          <Thumbnail
            image={product.featuredImage}
            fallback={<KindIcon kind="product" />}
          />
        }
        title={product.title}
      >
        {countLabel ?? undefined}
      </EntityRow>
      {variants.options.length > 0 && (
        <div className={styles.optionFilters}>
          <OptionFilters variants={variants} />
        </div>
      )}
      <span className="visually-hidden" role="status">
        {variantsAnnouncement(variants)}
      </span>
      <PanelBody env={env} variants={variants} panelRef={panelRef} />
    </div>
  );
}
