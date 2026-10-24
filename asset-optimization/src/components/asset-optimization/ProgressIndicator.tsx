import Callout from 'datocms-react-ui/Callout';
import EntityRow from 'datocms-react-ui/EntityRow';
import { Page } from 'datocms-react-ui/Page';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import Spinner from 'datocms-react-ui/Spinner';
import s from '../../entrypoints/OptimizeAssetsPage.module.css';
import { formatFileSize } from '../../utils/formatters';
import type { Asset } from '../../utils/optimizationUtils';
import { useFormatters } from '../../utils/useFormatters';

interface ProgressIndicatorProps {
  current: number;
  total: number;
  isLoading: boolean;
  /** The image that the run handles now */
  currentAsset?: Asset;
  isPreview: boolean;
  isCancelling: boolean;
}

function thumbnailUrl(asset: Asset): string {
  const url = new URL(asset.url);
  const parameters = { w: '64', h: '64', fit: 'crop', auto: 'format' };
  for (const [key, value] of Object.entries(parameters))
    url.searchParams.set(key, value);
  return url.toString();
}

/** The type, the size and the dimensions of an image, when they are known */
function assetDetails(asset: Asset): string {
  const details = [
    asset.path.split('.').pop()?.toUpperCase(),
    formatFileSize(asset.size),
    asset.width && asset.height
      ? `${asset.width}×${asset.height} px`
      : undefined,
  ];
  return details.filter(Boolean).join(' · ');
}

/** The progress of a run: what it does now, and the image it handles */
const ProgressIndicator = ({
  current,
  total,
  isLoading,
  currentAsset,
  isPreview,
  isCancelling,
}: ProgressIndicatorProps) => {
  const format = useFormatters();

  // Ensure percentage is calculated correctly and bounded to 0-100
  const percentage =
    total > 0
      ? Math.min(100, Math.max(0, Math.floor((current / total) * 100)))
      : 0;

  let status: string;
  if (isCancelling)
    status = 'Cancelling. Replacements already sent will finish first.';
  else if (isLoading)
    status = `Looking for images: ${format.count(total)} found`;
  else
    status = `Processing images: ${format.count(current)} of ${format.count(total)}`;

  return (
    <Page.Group title="Progress">
      <Callout>
        {isPreview
          ? 'This is a preview: no image is changed.'
          : 'Keep this page open until the run ends: leaving it cancels the run.'}
      </Callout>
      <div className={s.progress}>
        <div className={s.status} role="status" aria-live="polite">
          <Spinner inline label={false} />
          <span>{status}</span>
          {!isLoading && (
            <span className={s.percent}>{format.percent(percentage)}</span>
          )}
        </div>
        {!isLoading && (
          <ProgressBar value={percentage / 100} ariaLabel={status} />
        )}
        {currentAsset && (
          <EntityRow
            layout="row"
            kicker="Current image"
            image={<img src={thumbnailUrl(currentAsset)} alt="" />}
            title={currentAsset.basename}
          >
            {assetDetails(currentAsset)}
          </EntityRow>
        )}
      </div>
    </Page.Group>
  );
};

export default ProgressIndicator;
