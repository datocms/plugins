import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { useMediaQuery } from 'datocms-react-ui/hooks/useMediaQuery';
import type {
  MediaCardAction,
  MediaCardOption,
} from 'datocms-react-ui/MediaCard';
import type { CSSProperties } from 'react';
import { FileIcon, WarningIcon } from '../../icons';
import type { MediaLayoutItem } from '../../types';
import { getFormatLabel, isImageFormat } from '../../utils/upload';
import s from './styles.module.css';

type AssetMediaProps = {
  url: string;
  format: string | null;
  /** The crop of the asset, or null when it has none (Original, unknown size) */
  ratio: number | null;
  focalPoint: MediaLayoutItem['focalPoint'];
};

/**
 * The media of a MediaCard: the image at the crop of the asset (or of its
 * slot), or a box with the file icon and the format. Without a ratio, the
 * media keeps a minimum height.
 */
export function AssetMedia({
  url,
  format,
  ratio,
  focalPoint,
}: AssetMediaProps) {
  const hasRatio = ratio !== null && ratio > 0;
  const ratioStyle: CSSProperties | undefined = hasRatio
    ? { aspectRatio: String(ratio) }
    : undefined;
  const sizeClass = hasRatio ? undefined : s.noRatio;

  if (!url || !isImageFormat(format)) {
    const formatLabel = getFormatLabel(format);
    return (
      <div
        className={[s.filePlaceholder, sizeClass].filter(Boolean).join(' ')}
        style={ratioStyle}
      >
        <FileIcon />
        {formatLabel && (
          <span className={s.formatLabel}>{formatLabel.toUpperCase()}</span>
        )}
      </div>
    );
  }

  const focalX = focalPoint ? focalPoint.x * 100 : 50;
  const focalY = focalPoint ? focalPoint.y * 100 : 50;
  return (
    <img
      className={[s.media, sizeClass].filter(Boolean).join(' ')}
      src={`${url}?auto=format&w=400&fit=crop`}
      alt=""
      draggable={false}
      style={{ ...ratioStyle, objectPosition: `${focalX}% ${focalY}%` }}
    />
  );
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

/**
 * Where the state of an asset shows: "inline" when it is the only content of
 * its box (a column of a gallery, the frame of a single-asset field),
 * "section" under other content (the header of a slot).
 */
type AssetStatePlacement = 'inline' | 'section';

/** The upload of the asset still loads: the place of its card says so. */
export function LoadingAsset({
  placement,
}: {
  placement: AssetStatePlacement;
}) {
  return (
    <BlankSlate placement={placement} small loading title="Loading the asset" />
  );
}

type FailedAssetProps = {
  placement: AssetStatePlacement;
  disabled?: boolean;
  onRemove: () => void;
};

/**
 * The upload of the asset couldn't load: the user can remove the asset,
 * unless the field is read-only.
 */
export function FailedAsset({
  placement,
  disabled,
  onRemove,
}: FailedAssetProps) {
  return (
    <BlankSlate
      placement={placement}
      small
      icon={<WarningIcon />}
      error
      title="The asset couldn't load"
      description={
        disabled ? undefined : 'Remove it, then add the asset again.'
      }
      actions={
        !disabled && (
          <Button tone="ghost-alert" label="Remove" onClick={onRemove} />
        )
      }
    />
  );
}
