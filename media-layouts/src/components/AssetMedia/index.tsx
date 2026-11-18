import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { useElementLayout } from 'datocms-react-ui/hooks/useElementLayout';
import { useMediaQuery } from 'datocms-react-ui/hooks/useMediaQuery';
import type {
  MediaCardAction,
  MediaCardOption,
} from 'datocms-react-ui/MediaCard';
import UploadCard from 'datocms-react-ui/UploadCard';
import UploadPreview from 'datocms-react-ui/UploadPreview';
import { type ReactElement, useRef } from 'react';
import { WarningIcon } from '../../icons';
import type { MediaLayoutItem } from '../../types';
import { isImageFormat } from '../../utils/upload';
import s from './styles.module.css';

/** The longest side of the crop that the image service draws for a card */
const CROP_PREVIEW_SIZE = 600;

/**
 * The URL of the image at the crop of the asset (or of its slot), around its
 * focal point, and its size. The image service crops it, so the preview
 * shows the part of the image that the frontend gets.
 */
function cropPreview(
  url: string,
  ratio: number,
  focalPoint: MediaLayoutItem['focalPoint'],
) {
  const width = Math.round(
    ratio >= 1 ? CROP_PREVIEW_SIZE : CROP_PREVIEW_SIZE * ratio,
  );
  const height = Math.round(
    ratio >= 1 ? CROP_PREVIEW_SIZE / ratio : CROP_PREVIEW_SIZE,
  );
  const params = new URLSearchParams({
    auto: 'format',
    fit: 'crop',
    w: String(width),
    h: String(height),
  });
  if (focalPoint) {
    params.set('crop', 'focalpoint');
    params.set('fp-x', String(focalPoint.x));
    params.set('fp-y', String(focalPoint.y));
  }
  return { src: `${url}?${params.toString()}`, width, height };
}

type CroppedPreviewProps = {
  url: string;
  ratio: number;
  focalPoint: MediaLayoutItem['focalPoint'];
};

/**
 * The preview of an image at its crop: the box of the card (its CSS gives
 * the size) holds the cropped image, fitted as the Media Area fits an asset.
 */
function CroppedPreview({ url, ratio, focalPoint }: CroppedPreviewProps) {
  const ref = useRef<HTMLElement>(null);
  const { width, height } = useElementLayout(ref);
  const crop = cropPreview(url, ratio, focalPoint);

  return (
    <UploadPreview ref={ref} box={width && height ? { width, height } : null}>
      <UploadPreview.Image
        src={crop.src}
        width={crop.width}
        height={crop.height}
      />
    </UploadPreview>
  );
}

type AssetUploadCardProps = {
  uploadId: string;
  url: string;
  format: string | null;
  /** The crop of the asset, or null when it has none (Original, unknown size) */
  ratio: number | null;
  focalPoint: MediaLayoutItem['focalPoint'];
  caption: string;
  /** The field is read-only: the card has no actions */
  disabled: boolean;
  actions?: MediaCardAction[];
  options?: MediaCardOption[];
};

/**
 * The card of an asset, as the Media Area shows it. An image with a crop
 * shows at its crop; any other asset (an image at its original shape, an
 * SVG, a video, a file) shows as DatoCMS shows it, from its ID.
 */
export function AssetUploadCard({
  uploadId,
  url,
  format,
  ratio,
  focalPoint,
  caption,
  disabled,
  actions,
  options,
}: AssetUploadCardProps) {
  const cardProps = disabled
    ? { caption: { text: caption, muted: true }, disabled: true }
    : { caption: { text: caption }, actions, options };
  const showsCrop =
    Boolean(url) &&
    isImageFormat(format) &&
    // The image service rasterizes an SVG: it shows whole, as it is
    !format?.toLowerCase().includes('svg') &&
    ratio !== null &&
    ratio > 0;

  if (showsCrop && ratio !== null) {
    return (
      <UploadCard {...cardProps}>
        <CroppedPreview url={url} ratio={ratio} focalPoint={focalPoint} />
      </UploadCard>
    );
  }

  return <UploadCard {...cardProps} upload={uploadId || null} />;
}

type MediaCardMenus = {
  actions?: MediaCardAction[];
  options: MediaCardOption[];
};

/**
 * The actions of an asset card, and Remove in its "⋮". On a touch screen the
 * card draws its actions as a second "⋮" at the place of the first one, so
 * a tap could never reach Remove: there, one "⋮" holds the actions, then
 * Remove.
 */
export function useMediaCardMenus(
  actions: MediaCardAction[],
  onRemove: () => void,
): MediaCardMenus {
  const isTouchDevice = useMediaQuery('(hover: none)').matches;
  const remove: MediaCardOption = {
    label: 'Remove',
    alert: true,
    onClick: onRemove,
  };
  if (isTouchDevice) {
    return { options: [...actions, remove] };
  }
  return { actions, options: [remove] };
}

// The states of an asset sit in the place of its card, under a label of the
// form or the header of a slot: the "section" placement frames them as an
// empty slot, as the cards around them have a frame

/** The upload of the asset still loads: the place of its card says so. */
export function LoadingAsset() {
  return (
    <BlankSlate placement="section" small loading title="Loading the asset" />
  );
}

type FailedAssetProps = {
  /** The file name of the asset, when the field stored it */
  filename?: string | null;
  disabled?: boolean;
  onRemove: () => void;
};

/**
 * The upload of the asset couldn't load, most likely because it was deleted:
 * the user can remove the asset (a regular button, so that it reads as the
 * way out) and pick another, unless the field is read-only. The file name
 * tells which asset it was.
 */
export function FailedAsset({
  filename,
  disabled,
  onRemove,
}: FailedAssetProps) {
  const name = filename?.trim();
  let description: ReactElement | string | undefined;
  if (!disabled) {
    // One element: the description lays out each of its children apart
    description = name ? (
      <span>
        It may have been deleted. Remove{' '}
        <span className={s.filename}>{name}</span> and pick another asset.
      </span>
    ) : (
      'It may have been deleted. Remove it and pick another asset.'
    );
  }
  return (
    <BlankSlate
      placement="section"
      small
      icon={<WarningIcon />}
      error
      title="The asset couldn't load"
      description={description}
      actions={!disabled && <Button label="Remove" onClick={onRemove} />}
    />
  );
}
