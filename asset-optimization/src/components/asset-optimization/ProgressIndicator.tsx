import type { ReactElement } from 'react';
import s from '../../entrypoints/styles.module.css';
import { Spinner } from 'datocms-react-ui';
import type { Asset } from '../../utils/optimizationUtils';

interface ProgressIndicatorProps {
  current: number;
  total: number;
  isVisible: boolean;
  assetSizeCategory?: string; // Category of assets being processed (large, very large)
  currentAsset?: Asset; // Current asset being processed
  isPreview?: boolean; // Whether this is a preview operation
}

/**
 * ProgressIndicator component displays progress during asset optimization
 * 
 * @param current - Current progress value
 * @param total - Total number of assets to process
 * @param isVisible - Whether the progress indicator should be visible
 * @param assetSizeCategory - Category of assets being processed (large, very large)
 * @param currentAsset - The current asset being processed
 * @param isPreview - Whether this is a preview operation
 * @returns Rendered progress bar or null if not visible
 */
const ProgressIndicator = ({ 
  current, 
  total, 
  isVisible,
  assetSizeCategory = 'large',
  currentAsset,
  isPreview
}: ProgressIndicatorProps): ReactElement | null => {
  if (!isVisible) return null;
  
  // Ensure percentage is calculated correctly and bounded to 0-100
  const percentage = total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : 0;
  
  return (
    <div className={s.optimizingContainer}>
      {isPreview && (
        <div className={s.previewInfoBox}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <title>Information</title>
            <path d="M12 22C6.477 22 2 17.523 2 12C2 6.477 6.477 2 12 2C17.523 2 22 6.477 22 12C22 17.523 17.523 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM11 7H13V9H11V7ZM11 11H13V17H11V11Z" fill="currentColor"/>
          </svg>
          <p>
            <strong>Preview Mode</strong> - This will calculate potential savings without modifying any assets.
          </p>
        </div>
      )}
      {currentAsset && (
        <div className={s.currentAssetPreview}>
          <div className={s.assetPreviewImage}>
            <img 
              src={`${currentAsset.url}?w=120&h=80&fit=crop&auto=format`} 
              alt={currentAsset.basename} 
            />
          </div>
          <div className={s.assetPreviewInfo}>
            <div className={s.assetPreviewTitle}>{currentAsset.basename}</div>
            <div className={s.assetPreviewMeta}>
              {currentAsset.path.split('.').pop()?.toUpperCase()} • {(currentAsset.size / (1024 * 1024)).toFixed(2)} MB • {currentAsset.width}×{currentAsset.height}px
            </div>
          </div>
        </div>
      )}
      <div className={s.statusText}>
        <Spinner size={16} /> <span>Processing {assetSizeCategory} assets: {current} of {total}</span>
      </div>
      <div className={s.percentageText}>
        <span>{percentage}%</span>
      </div>
      <div className={s.progressBar}>
        <div 
          className={s.progressBarFill} 
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export default ProgressIndicator;
