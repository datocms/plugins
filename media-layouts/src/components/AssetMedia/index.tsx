import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import FileTypeIcon from 'datocms-react-ui/FileTypeIcon';
import { useMediaQuery } from 'datocms-react-ui/hooks/useMediaQuery';
import type {
  MediaCardAction,
  MediaCardOption,
} from 'datocms-react-ui/MediaCard';
import type { CSSProperties, ReactElement } from 'react';
import { WarningIcon } from '../../icons';
import type { MediaLayoutItem } from '../../types';
import { getFormatLabel, isImageFormat } from '../../utils/upload';
import s from './styles.module.css';

type AssetMediaProps = {
  url: string;
  format: string | null;
  /** The crop of the asset, or null when it has none (Original, unknown size) */
  ratio: number | null;
  focalPoint: MediaLayoutItem['focalPoint'];
  /**
   * A gallery: the media sits in a frame of one shape (FRAME_RATIO), thus
   * the cards of a row have one height
   */
  framed?: boolean;
};

/** The shape of the frame of the media in a gallery: 4:3 */
const FRAME_RATIO = 4 / 3;

/**
 * The media of a MediaCard: the image at the crop of the asset (or of its
 * slot), or a box with the icon of the type of the file. Without a ratio, the
 * media keeps a minimum height. In a frame, the image keeps its crop at the
 * center of the frame (as wide as the frame, or as tall), and the box of a
 * file fills the frame.
 */
export function AssetMedia({
  url,
  format,
  ratio,
  focalPoint,
  framed = false,
}: AssetMediaProps) {
  const hasRatio = ratio !== null && ratio > 0;
  const ratioStyle: CSSProperties | undefined = hasRatio
    ? { aspectRatio: String(ratio) }
    : undefined;
  const sizeClass = hasRatio ? undefined : s.noRatio;

  if (!url || !isImageFormat(format)) {
    return (
      <div
        className={[s.filePlaceholder, framed ? s.frame : sizeClass]
          .filter(Boolean)
          .join(' ')}
        style={framed ? undefined : ratioStyle}
      >
        <FileTypeIcon
          className={s.fileIcon}
          extension={getFormatLabel(format) ?? undefined}
        />
      </div>
    );
  }

  const focalX = focalPoint ? focalPoint.x * 100 : 50;
  const focalY = focalPoint ? focalPoint.y * 100 : 50;
  const src = `${url}?auto=format&w=400&fit=crop`;
  const objectPosition = `${focalX}% ${focalY}%`;

  if (!framed) {
    return (
      <img
        className={[s.media, sizeClass].filter(Boolean).join(' ')}
        src={src}
        alt=""
        draggable={false}
        style={{ ...ratioStyle, objectPosition }}
      />
    );
  }

  // A crop taller than the frame is as tall as the frame: its width is the
  // part of the width of the frame that its ratio gives
  const framedStyle: CSSProperties = hasRatio
    ? {
        ...ratioStyle,
        width: `${Math.min(1, ratio / FRAME_RATIO) * 100}%`,
      }
    : {};
  return (
    <div className={s.frame}>
      <img
        className={hasRatio ? s.framedMedia : s.framedOriginal}
        src={src}
        alt=""
        draggable={false}
        style={{ ...framedStyle, objectPosition }}
      />
    </div>
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
