import Callout from 'datocms-react-ui/Callout';
import InfoList from 'datocms-react-ui/InfoList';
import { Page } from 'datocms-react-ui/Page';
import { formatFileSize } from '../../utils/formatters';
import type { AssetOptimizerResult } from '../../utils/optimizationUtils';
import { useFormatters } from '../../utils/useFormatters';

interface ResultsStatsProps {
  result: AssetOptimizerResult;
  largeAssetThreshold: number;
  isPreview: boolean;
}

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

/** Why a run stopped before its end, or nothing when it ran to the end */
function StoppedCallout({
  result,
  isPreview,
}: {
  result: AssetOptimizerResult;
  isPreview: boolean;
}) {
  const format = useFormatters();
  if (!result.cancelled && !result.stoppedReason) return null;

  if (result.inventoryIncomplete) {
    const found = format.plural(
      result.totalAssets,
      'matching image was',
      'matching images were',
    );
    return (
      <Callout tone="warning" title="Search stopped">
        {`The search stopped after ${found} found, so the full count is unknown. No image was replaced.`}
      </Callout>
    );
  }

  const reason = result.stoppedReason ?? 'You cancelled the run.';
  const sent = isPreview
    ? ''
    : ', and replacements already sent were allowed to finish';
  const unprocessed = format.plural(
    result.unprocessed ?? 0,
    "image wasn't",
    "images weren't",
  );
  return (
    <Callout tone="warning" title="Run stopped">
      {`${reason} ${unprocessed} processed${sent}.`}
    </Callout>
  );
}

/** The summary of a finished run: its notes and its numbers */
const ResultsStats = ({
  result,
  largeAssetThreshold,
  isPreview,
}: ResultsStatsProps) => {
  const format = useFormatters();
  const { optimized, skipped, failed, totalAssets, optimizedAssets } = result;

  const totalBytesSaved = computeTotalBytesSaved(optimizedAssets);
  const avgOptimizationPerAsset = computeAvgOptimization(optimizedAssets);

  const showNoAssetsInfo =
    totalAssets === 0 && Boolean(largeAssetThreshold) && !result.cancelled;

  return (
    <Page.Group title="Summary">
      <StoppedCallout result={result} isPreview={isPreview} />
      {isPreview && (
        <Callout>These are the expected savings: no image was changed.</Callout>
      )}
      {showNoAssetsInfo && (
        <Callout title="No large images found">
          {`No image in this scope is ${format.count(largeAssetThreshold)} MB or larger. Lower the large image threshold to include more images.`}
        </Callout>
      )}
      <InfoList>
        <InfoList.Row title="Images found">
          {format.count(totalAssets)}
        </InfoList.Row>
        <InfoList.Row title={isPreview ? 'Can be optimized' : 'Optimized'}>
          {format.count(optimized)}
        </InfoList.Row>
        <InfoList.Row title="Skipped">{format.count(skipped)}</InfoList.Row>
        <InfoList.Row title="Failed">{format.count(failed)}</InfoList.Row>
        <InfoList.Row
          title={isPreview ? 'Expected storage saved' : 'Storage saved'}
        >
          {formatFileSize(totalBytesSaved)}
        </InfoList.Row>
        <InfoList.Row title="Average reduction per image">
          {format.percent(avgOptimizationPerAsset)}
        </InfoList.Row>
      </InfoList>
    </Page.Group>
  );
};

export default ResultsStats;
