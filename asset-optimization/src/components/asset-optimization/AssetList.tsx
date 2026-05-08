import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button } from 'datocms-react-ui';
import type { ReactElement } from 'react';
import s from '../../entrypoints/styles.module.css';
import { formatFileSize } from '../../utils/formatters';
import type {
  Asset,
  OptimizedAsset as OptimizedAssetType,
  ProcessedAsset,
} from '../../utils/optimizationUtils';

interface AssetListProps {
  assets: Asset[] | OptimizedAssetType[] | ProcessedAsset[];
  category: 'optimized' | 'skipped' | 'failed';
  /**
   * True when the parent page is showing results from a "Preview Optimization"
   * (dry-run) pass — no assets were modified and the original asset URL still
   * points at the unmodified bytes. The "View Asset" button switches to the
   * Imgix preview URL in this mode so editors can actually compare the
   * predicted optimized output instead of being silently routed back to the
   * original.
   */
  isPreview?: boolean;
  onClose?: () => void;
  ctx: RenderPageCtx;
}

// Local interface to ensure we have a complete asset with optimization properties
interface DisplayAsset extends Asset {
  originalSize?: number;
  optimizedSize?: number;
  optimizedUrl?: string;
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
  const optimizedUrl =
    'optimizedUrl' in asset ? (asset.optimizedUrl as string | undefined) : undefined;
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
    optimizedUrl,
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
  isPreview: boolean;
  ctx: RenderPageCtx;
};

const AssetListItem = ({
  asset,
  category,
  isPreview,
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

  // In preview mode the asset URL is still the unmodified original — opening
  // it from the "View Asset" button just shows the pre-optimization image and
  // confused editors into thinking the optimization didn't apply. Prefer the
  // dry-run Imgix URL when we have one so the button actually surfaces the
  // predicted output.
  const showOptimizedPreview =
    isPreview && category === 'optimized' && Boolean(displayAsset.optimizedUrl);
  const viewAssetLabel = showOptimizedPreview
    ? 'View optimized preview'
    : 'View Asset';
  const viewAssetUrl = showOptimizedPreview
    ? (displayAsset.optimizedUrl as string)
    : displayAsset.url;

  return (
    <li key={displayAsset.id} className={s.assetListItem}>
      <div className={s.assetItemContent}>
        <div className={s.assetIcon}>
          <div className={s.fileIconWrapper}>{fileExtension.toUpperCase()}</div>
        </div>
        <div className={s.assetDetails}>
          <p className={s.assetPath}>{displayAsset.path}</p>
          {showOptimizationStats && (
            <div className={s.optimizationStats}>
              <div className={s.sizeInfo}>
                <div className={s.sizeBefore}>
                  <span className={s.sizeLabel}>Original:</span>
                  <span className={s.sizeValue}>
                    {formatFileSize(displayAsset.originalSize ?? 0)}
                  </span>
                </div>
                <div className={s.sizeArrow}>&#8594;</div>
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
            onClick={() => window.open(viewAssetUrl, '_blank')}
          >
            {viewAssetLabel}
          </Button>
          {/*
           * The Media Area link is hidden in preview mode for optimized
           * entries: nothing has been written back to the media library yet,
           * so jumping into it would just show the original asset and
           * reinforce the misconception that the optimization already ran.
           * It still appears for skipped/failed entries (where the media
           * library still has useful context) and for non-preview runs.
           */}
          {!showOptimizedPreview && (
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
          )}
        </div>
      </div>
    </li>
  );
};

/**
 * AssetList component displays categorized lists of assets (optimized, skipped, or failed)
 *
 * This component displays a list of assets based on the selected category with action buttons:
 * - "View Asset" / "View optimized preview" button - opens the asset (or, in
 *   preview mode for optimized entries, the dry-run Imgix URL) in a new tab
 * - "Media Area" button - jumps to the asset in the DatoCMS media library
 */
const AssetList = ({
  assets,
  category,
  isPreview = false,
  onClose,
  ctx,
}: AssetListProps): ReactElement => {
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
        <ul className={s.assetList}>
          {assets.map((asset) => (
            <AssetListItem
              key={asset.id}
              asset={asset}
              category={category}
              isPreview={isPreview}
              ctx={ctx}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

export default AssetList;
