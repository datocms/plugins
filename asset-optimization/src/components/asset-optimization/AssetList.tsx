import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button } from 'datocms-react-ui';
import { type ReactElement, useEffect, useState } from 'react';
import s from '../../entrypoints/styles.module.css';
import { formatFileSize } from '../../utils/formatters';
import type {
  Asset,
  OptimizedAsset as OptimizedAssetType,
  ProcessedAsset,
} from '../../utils/optimizationUtils';
import { ASSET_PAGE_SIZE, getAssetPage } from './presentation';

interface AssetListProps {
  assets: Asset[] | OptimizedAssetType[] | ProcessedAsset[];
  category: 'optimized' | 'skipped' | 'failed';
  onClose?: () => void;
  ctx: RenderPageCtx;
}

// Local interface to ensure we have a complete asset with optimization properties
interface DisplayAsset extends Asset {
  originalSize?: number;
  optimizedSize?: number;
}

const getCategoryBadgeClass = (
  category: 'optimized' | 'skipped' | 'failed',
): string => {
  switch (category) {
    case 'optimized':
      return s.badgeGreen;
    case 'failed':
      return s.badgeRed;
    case 'skipped':
      return s.badgeGray;
    default:
      return s.badgeBlue;
  }
};

const normalizeToDisplayAsset = (
  asset: Asset | OptimizedAssetType | ProcessedAsset,
): DisplayAsset => {
  const originalSize =
    'originalSize' in asset ? (asset.originalSize as number) : undefined;
  const optimizedSize =
    'optimizedSize' in asset ? (asset.optimizedSize as number) : undefined;
  const size = 'size' in asset ? asset.size : (originalSize ?? 0);
  const basename = 'basename' in asset ? asset.basename : '';

  return {
    id: asset.id,
    path: asset.path,
    url: asset.url,
    is_image: true,
    size,
    basename,
    originalSize,
    optimizedSize,
  };
};

const computeSavingsPercentage = (
  originalSize: number | undefined,
  optimizedSize: number | undefined,
): number | null => {
  if (!originalSize || !optimizedSize) {
    return null;
  }
  return Math.round(((originalSize - optimizedSize) / originalSize) * 100);
};

type AssetListItemProps = {
  asset: Asset | OptimizedAssetType | ProcessedAsset;
  category: 'optimized' | 'skipped' | 'failed';
  ctx: RenderPageCtx;
};

const AssetListItem = ({
  asset,
  category,
  ctx,
}: AssetListItemProps): ReactElement => {
  const displayAsset = normalizeToDisplayAsset(asset);
  const savingsPercentage = computeSavingsPercentage(
    displayAsset.originalSize,
    displayAsset.optimizedSize,
  );
  const fileExtension = displayAsset.path.split('.').pop() ?? '';
  const showOptimizationStats =
    category === 'optimized' &&
    Boolean(displayAsset.originalSize) &&
    Boolean(displayAsset.optimizedSize);

  return (
    <li key={displayAsset.id} className={s.assetListItem}>
      <div className={s.assetItemContent}>
        <div className={s.assetIcon}>
          <div className={s.fileIconWrapper}>{fileExtension.toUpperCase()}</div>
        </div>
        <div className={s.assetDetails}>
          <p className={s.assetPath}>{displayAsset.path}</p>
          {'error' in asset &&
            typeof asset.error === 'string' &&
            asset.error && (
              <p
                style={{
                  margin: 'var(--spacing-s) 0 0',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color--ink-danger)',
                  overflowWrap: 'anywhere',
                }}
              >
                {asset.error}
              </p>
            )}
          {showOptimizationStats && (
            <div className={s.optimizationStats}>
              <div className={s.sizeInfo}>
                <div className={s.sizeBefore}>
                  <span className={s.sizeLabel}>Original:</span>
                  <span className={s.sizeValue}>
                    {formatFileSize(displayAsset.originalSize ?? 0)}
                  </span>
                </div>
                <div className={s.sizeArrow}>→</div>
                <div className={s.sizeAfter}>
                  <span className={s.sizeLabel}>Optimized:</span>
                  <span className={s.sizeValue}>
                    {formatFileSize(displayAsset.optimizedSize ?? 0)}
                  </span>
                </div>
              </div>
              {savingsPercentage && (
                <div className={`${s.savingsBadge} ${s.badgeGreen}`}>
                  {savingsPercentage}% savings
                </div>
              )}
            </div>
          )}
        </div>
        <div className={s.assetActions}>
          <Button
            buttonSize="xxs"
            buttonType="primary"
            onClick={() => window.open(displayAsset.url, '_blank')}
          >
            View Asset
          </Button>
          <Button
            buttonSize="xxs"
            buttonType="muted"
            style={{ marginLeft: '8px' }}
            onClick={() =>
              window.open(
                `https://${ctx.site.attributes.internal_domain}/environments/${ctx.environment}/media/assets/${displayAsset.id}`,
                '_blank',
              )
            }
          >
            Media Area
          </Button>
        </div>
      </div>
    </li>
  );
};

/**
 * AssetList component displays categorized lists of assets (optimized, skipped, or failed)
 *
 * This component displays a list of assets based on the selected category with action buttons:
 * - "View Asset" button - Opens the asset in a new tab
 */
const AssetList = ({
  assets,
  category,
  onClose,
  ctx,
}: AssetListProps): ReactElement => {
  const [page, setPage] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset pagination whenever the selected result set changes.
  useEffect(() => {
    setPage(0);
  }, [assets, category]);

  const assetPage = getAssetPage<Asset | OptimizedAssetType | ProcessedAsset>(
    assets,
    page,
  );
  const badgeClass = getCategoryBadgeClass(category);
  const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);

  return (
    <div className={s.assetListCard}>
      <div className={s.assetListHeader}>
        <div className={s.assetListHeaderTitle}>
          <div className={`${s.categoryBadge} ${badgeClass}`}>
            {assets.length}
          </div>
          <h3>{categoryTitle} Assets</h3>
        </div>
        {onClose && (
          <Button buttonType="negative" buttonSize="xs" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      {assets.length === 0 ? (
        <div className={s.noAssetsMessage}>
          No {category} assets to display.
        </div>
      ) : (
        <ul key={`${category}-${assetPage.page}`} className={s.assetList}>
          {assetPage.assets.map((asset) => (
            <AssetListItem
              key={asset.id}
              asset={asset}
              category={category}
              ctx={ctx}
            />
          ))}
        </ul>
      )}

      {assets.length > ASSET_PAGE_SIZE && (
        <nav
          aria-label={`${categoryTitle} assets pagination`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--spacing-s)',
            flexWrap: 'wrap',
            padding: 'var(--spacing-m)',
            borderTop: '1px solid var(--color--border)',
          }}
        >
          <Button
            buttonType="muted"
            buttonSize="xxs"
            disabled={assetPage.page === 0}
            onClick={() => setPage(assetPage.page - 1)}
          >
            Previous
          </Button>
          <span aria-live="polite">
            {assetPage.start + 1}–{assetPage.end} of {assets.length} assets
            {' · '}Page {assetPage.page + 1} of {assetPage.totalPages}
          </span>
          <Button
            buttonType="muted"
            buttonSize="xxs"
            disabled={assetPage.page === assetPage.totalPages - 1}
            onClick={() => setPage(assetPage.page + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  );
};

export default AssetList;
