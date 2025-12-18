import type { ReactElement } from 'react';
import { Button } from 'datocms-react-ui';
import s from '../../entrypoints/styles.module.css';
import type { Asset, OptimizedAsset as OptimizedAssetType, ProcessedAsset } from '../../utils/optimizationUtils';
import { formatFileSize } from '../../utils/formatters';
import type { RenderPageCtx } from 'datocms-plugin-sdk';

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

/**
 * AssetList component displays categorized lists of assets (optimized, skipped, or failed)
 * 
 * This component displays a list of assets based on the selected category with action buttons:
 * - "View Asset" button - Opens the asset in a new tab
 */
const AssetList = ({ assets, category, onClose, ctx }: AssetListProps): ReactElement => {
  // Get the badge color based on category
  const getBadgeColor = () => {
    switch (category) {
      case 'optimized': return s.badgeGreen;
      case 'failed': return s.badgeRed;
      case 'skipped': return s.badgeGray;
      default: return s.badgeBlue;
    }
  };

  return (
    <div className={s.assetListCard}>
      <div className={s.assetListHeader}>
        <div className={s.assetListHeaderTitle}>
          <div className={`${s.categoryBadge} ${getBadgeColor()}`}>{assets.length}</div>
          <h3>{category.charAt(0).toUpperCase() + category.slice(1)} Assets</h3>
        </div>
        {onClose && (
          <Button
            buttonType="negative"
            buttonSize="xs"
            onClick={onClose}
          >
            Close
          </Button>
        )}
      </div>
      
      {assets.length === 0 ? (
        <div className={s.noAssetsMessage}>No {category} assets to display.</div>
      ) : (
        <ul className={s.assetList}>
          {assets.map((asset) => {
            // Create a display asset with all expected properties
            const displayAsset: DisplayAsset = {
              // Asset properties
              id: asset.id,
              path: asset.path,
              url: asset.url,
              is_image: true,
              size: ('size' in asset) ? asset.size : ('originalSize' in asset) ? asset.originalSize as number : 0,
              basename: ('basename' in asset) ? asset.basename : '',
              
              // Optional optimization properties
              originalSize: ('originalSize' in asset) ? asset.originalSize as number : undefined,
              optimizedSize: ('optimizedSize' in asset) ? asset.optimizedSize as number : undefined
            };
            
            // Calculate savings percentage if applicable
            const savingsPercentage = displayAsset.originalSize && displayAsset.optimizedSize
              ? Math.round((displayAsset.originalSize - displayAsset.optimizedSize) / displayAsset.originalSize * 100)
              : null;
              
            // Get file extension from path
            const fileExtension = displayAsset.path.split('.').pop() || '';
            
            return (
              <li key={displayAsset.id} className={s.assetListItem}>
                <div className={s.assetItemContent}>
                  <div className={s.assetIcon}>
                    <div className={s.fileIconWrapper}>{fileExtension.toUpperCase()}</div>
                  </div>
                  <div className={s.assetDetails}>
                    <p className={s.assetPath}>{displayAsset.path}</p>
                    {category === 'optimized' && displayAsset.originalSize && displayAsset.optimizedSize && (
                      <div className={s.optimizationStats}>
                        <div className={s.sizeInfo}>
                          <div className={s.sizeBefore}>
                            <span className={s.sizeLabel}>Original:</span>
                            <span className={s.sizeValue}>{formatFileSize(displayAsset.originalSize)}</span>
                          </div>
                          <div className={s.sizeArrow}>&#8594;</div>
                          <div className={s.sizeAfter}>
                            <span className={s.sizeLabel}>Optimized:</span>
                            <span className={s.sizeValue}>{formatFileSize(displayAsset.optimizedSize)}</span>
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
                      onClick={() => window.open(`https://${ctx.site.attributes.internal_domain}/environments/${ctx.environment}/media/assets/${displayAsset.id}`, '_blank')}
                    >
                      Media Area
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default AssetList;
