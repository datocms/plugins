import { Button } from 'datocms-react-ui';
import type { ReactElement } from 'react';
import s from '../../entrypoints/styles.module.css';
import type { AssetOptimizerResult } from '../../utils/optimizationUtils';

/**
 * Props for the ResultsStats component
 */
interface ResultsStatsProps {
  result: AssetOptimizerResult | null;
  setSelectedCategory: (
    category: 'optimized' | 'skipped' | 'failed' | null,
  ) => void;
  resetState?: () => void;
  largeAssetThreshold?: number;
  isPreview: boolean; // Update the prop type to make it required
}

const formatBytesSaved = (totalBytesSaved: number): string => {
  if (totalBytesSaved < 1024) {
    return `${totalBytesSaved} bytes`;
  }
  if (totalBytesSaved < 1024 * 1024) {
    return `${(totalBytesSaved / 1024).toFixed(1)} KB`;
  }
  return `${(totalBytesSaved / (1024 * 1024)).toFixed(1)} MB`;
};

const computeTotalBytesSaved = (
  optimizedAssets: AssetOptimizerResult['optimizedAssets'],
): number => {
  return optimizedAssets.reduce(
    (acc, asset) => acc + (asset.originalSize - asset.optimizedSize),
    0,
  );
};

const computeAvgOptimization = (
  optimizedAssets: AssetOptimizerResult['optimizedAssets'],
): number => {
  if (optimizedAssets.length === 0) {
    return 0;
  }
  const totalPct = optimizedAssets.reduce(
    (acc, asset) =>
      acc +
      ((asset.originalSize - asset.optimizedSize) / asset.originalSize) * 100,
    0,
  );
  return Math.round(totalPct / optimizedAssets.length);
};

type StatCategory = 'optimized' | 'skipped' | 'failed';

type ClickableStatCardProps = {
  title: string;
  count: number;
  valueClassName: string;
  category: StatCategory;
  onSelect: (cat: StatCategory | null) => void;
};

const ClickableStatCard = ({
  title,
  count,
  valueClassName,
  category,
  onSelect,
}: ClickableStatCardProps): ReactElement => {
  const isClickable = count > 0;
  const handleClick = () => {
    if (isClickable) {
      onSelect(category);
    }
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSelect(category);
    }
  };

  return (
    <div
      className={`${s.statsCard} ${isClickable ? s.clickableStatsCard : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <h3 className={s.statsCardTitle}>{title}</h3>
      <div className={`${s.statsCardValue} ${valueClassName}`}>{count}</div>
      <div className={s.statsCardLabel}>
        {isClickable ? 'Click to view' : `No ${title.toLowerCase()} assets`}
      </div>
    </div>
  );
};

/**
 * ResultsStats component for displaying optimization results
 *
 * Shows summary statistics of optimization process and allows
 * users to view detailed lists of optimized, skipped, or failed assets.
 *
 * @param result - The results of the optimization process
 * @param setSelectedCategory - Function to update the selected category
 * @param resetState - Function to reset the optimization state and start a new one
 * @returns Rendered component or null if no results
 */
const ResultsStats = ({
  result,
  setSelectedCategory,
  resetState,
  largeAssetThreshold,
  isPreview,
}: ResultsStatsProps): ReactElement | null => {
  if (!result) return null;

  const { optimized, skipped, failed, totalAssets, optimizedAssets } = result;

  const totalBytesSaved = computeTotalBytesSaved(optimizedAssets);
  const avgOptimizationPerAsset = computeAvgOptimization(optimizedAssets);

  const handleNewOptimization = () => {
    if (resetState) {
      resetState();
    } else {
      setSelectedCategory(null);
    }
  };

  const showNoAssetsInfo = totalAssets === 0 && Boolean(largeAssetThreshold);

  return (
    <div className={s.resultsContainer}>
      <h2 className={s.optimizationSummaryTitle}>
        {isPreview ? 'Preview Summary' : 'Optimization Summary'}
      </h2>

      {isPreview && (
        <div className={s.previewInfoBox}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <title>Information</title>
            <path
              d="M12 22C6.477 22 2 17.523 2 12C2 6.477 6.477 2 12 2C17.523 2 22 6.477 22 12C22 17.523 17.523 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM11 7H13V9H11V7ZM11 11H13V17H11V11Z"
              fill="currentColor"
            />
          </svg>
          <p>
            <strong>Preview Mode</strong> - This is an estimation of potential
            savings. No assets have been modified.
          </p>
        </div>
      )}

      {showNoAssetsInfo && (
        <div
          className={`${s.infoBox}`}
          style={{
            margin: '0 0 16px 0',
            padding: '16px',
            backgroundColor: 'var(--light-bg-color)',
            borderRadius: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                marginRight: '8px',
                color: 'var(--accent-color)',
                display: 'flex',
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <title>Information</title>
                <path
                  d="M12 22C6.477 22 2 17.523 2 12C2 6.477 6.477 2 12 2C17.523 2 22 6.477 22 12C22 17.523 17.523 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM11 7H13V9H11V7ZM11 11H13V17H11V11Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <p style={{ margin: 0, color: 'var(--base-body-color)' }}>
              No images in your project are larger than{' '}
              <strong>{largeAssetThreshold}MB</strong>. Try lowering the minimum
              size threshold to optimize more assets.
            </p>
          </div>
        </div>
      )}

      <div className={s.statsCardGrid}>
        <div className={s.statsCard}>
          <h3 className={s.statsCardTitle}>Total Assets</h3>
          <div className={s.statsCardValue}>{totalAssets}</div>
          <div className={s.statsCardLabel}>
            {totalAssets > 0 ? 'Total' : 'No assets found'}
          </div>
        </div>

        <ClickableStatCard
          title="Optimized"
          count={optimized}
          valueClassName={s.optimizedValue}
          category="optimized"
          onSelect={setSelectedCategory}
        />

        <ClickableStatCard
          title="Skipped"
          count={skipped}
          valueClassName={s.skippedValue}
          category="skipped"
          onSelect={setSelectedCategory}
        />

        <ClickableStatCard
          title="Failed"
          count={failed}
          valueClassName={s.failedValue}
          category="failed"
          onSelect={setSelectedCategory}
        />
      </div>

      <div className={s.savingsSummary}>
        <div className={s.savingsCard}>
          <div className={s.savingsRow}>
            <div className={s.savingsLabel}>Total Storage Saved</div>
            <div className={s.savingsValue}>
              {formatBytesSaved(totalBytesSaved)}
            </div>
          </div>
          <div className={s.savingsRow}>
            <div className={s.savingsLabel}>Average Optimization per Asset</div>
            <div className={s.savingsValue}>{avgOptimizationPerAsset}%</div>
          </div>
        </div>
      </div>

      <div className={s.actionsContainer}>
        <Button
          buttonType="primary"
          buttonSize="l"
          onClick={handleNewOptimization}
          fullWidth
        >
          {isPreview ? 'New Preview' : 'New Optimization'}
        </Button>
      </div>
    </div>
  );
};

export default ResultsStats;
