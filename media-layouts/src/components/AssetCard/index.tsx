import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import MediaCard from 'datocms-react-ui/MediaCard';
import { memo, type ReactNode } from 'react';
import { useUploadData } from '../../hooks/useUploadData';
import { EditIcon, ReplaceIcon } from '../../icons';
import type { MediaLayoutItem, Upload, WidthOption } from '../../types';
import { getEffectiveRatio } from '../../utils/aspectRatio';
import { assetTitle } from '../../utils/options';
import { assetLoadState, resolveFormat } from '../../utils/upload';
import { AssetOptionFields, CropFields } from '../AssetFields';
import {
  AssetMedia,
  FailedAsset,
  LoadingAsset,
  useMediaCardMenus,
} from '../AssetMedia';
import s from './styles.module.css';

/**
 * The assets of a single-asset or a gallery field: a grid of columns of the
 * same width, as in the gallery of the CMS. A single asset takes the first
 * column.
 */
export function AssetGrid({ children }: { children: ReactNode }) {
  return <div className={s.grid}>{children}</div>;
}

export type AssetItemProps = {
  ctx: RenderFieldExtensionCtx;
  item: MediaLayoutItem;
  /** The position of the item in the value of the field */
  index: number;
  widthOptions: WidthOption[];
  enableCssClass: boolean;
  enableLazyLoading: boolean;
  /** The field is read-only: the inputs are disabled and the actions hidden */
  disabled: boolean;
  onChange: (index: number, change: Partial<MediaLayoutItem>) => void;
  onRemove: (index: number) => void;
  onEditMetadata: (index: number) => void;
  /** Single asset only: picks another asset in the place of this one */
  onReplace?: () => void;
};

type ResolvedCardData = {
  url: string;
  filename: string;
  format: string | null;
  originalWidth: number | null;
  originalHeight: number | null;
};

function resolveCardData(
  item: MediaLayoutItem,
  upload: Upload | null,
): ResolvedCardData {
  const url = item.url || upload?.attributes.url || '';
  const filename = item.filename || upload?.attributes.filename || '';
  const format = resolveFormat({
    format: item.format ?? upload?.attributes.format ?? null,
    url,
    filename,
  });
  const originalWidth = item.originalWidth ?? upload?.attributes.width ?? null;
  const originalHeight =
    item.originalHeight ?? upload?.attributes.height ?? null;
  return { url, filename, format, originalWidth, originalHeight };
}

/**
 * The item misses data that only the upload has: its URL, name or format,
 * or the original size that an Original width or aspect ratio needs.
 */
function needsUploadFetch(item: MediaLayoutItem): boolean {
  const baseFormat = resolveFormat({
    format: item.format,
    url: item.url,
    filename: item.filename,
  });
  const needsOriginalWidth =
    item.width === 'original' || item.aspectRatio === 'original';
  const needsOriginalHeight = item.aspectRatio === 'original';
  return (
    !item.url ||
    !item.filename ||
    !baseFormat ||
    (needsOriginalWidth && !item.originalWidth) ||
    (needsOriginalHeight && !item.originalHeight)
  );
}

type AssetCardProps = {
  item: MediaLayoutItem;
  data: ResolvedCardData;
  disabled: boolean;
  onReplace?: () => void;
  onEditMetadata: () => void;
  onRemove: () => void;
};

/**
 * The card of the asset, at its crop: Replace (single asset) and Edit
 * metadata on the media, Remove in the "⋮" (a touch screen has them all in
 * the "⋮"). A read-only field shows the card alone.
 */
function AssetCard({
  item,
  data,
  disabled,
  onReplace,
  onEditMetadata,
  onRemove,
}: AssetCardProps) {
  const editMetadata = {
    label: 'Edit metadata',
    icon: EditIcon,
    onClick: onEditMetadata,
  };
  const menus = useMediaCardMenus(
    onReplace
      ? [
          { label: 'Replace', icon: ReplaceIcon, onClick: onReplace },
          editMetadata,
        ]
      : [editMetadata],
    onRemove,
  );
  const caption = assetTitle({
    filename: data.filename,
    uploadId: item.uploadId,
  });
  const media = (
    <AssetMedia
      url={data.url}
      format={data.format}
      ratio={getEffectiveRatio(
        item.aspectRatio,
        item.customAspectRatio,
        data.originalWidth,
        data.originalHeight,
      )}
      focalPoint={item.focalPoint}
    />
  );

  if (disabled) {
    return (
      <MediaCard caption={caption} isDisabled captionDisabled>
        {media}
      </MediaCard>
    );
  }

  return (
    <MediaCard
      caption={caption}
      actions={menus.actions}
      options={menus.options}
    >
      {media}
    </MediaCard>
  );
}

/**
 * One asset of the field, as a column: its card, then its crop, its width
 * and its options. While its upload loads (or when it fails), the column
 * says so in the place of the card.
 */
function AssetItem({
  ctx,
  item,
  index,
  widthOptions,
  enableCssClass,
  enableLazyLoading,
  disabled,
  onChange,
  onRemove,
  onEditMetadata,
  onReplace,
}: AssetItemProps) {
  const needsFetch = needsUploadFetch(item);
  const { upload, error } = useUploadData(ctx, item.uploadId, !needsFetch);
  const state = assetLoadState({
    needsFetch,
    url: item.url,
    uploadId: item.uploadId,
    upload,
    error,
  });
  const handleRemove = () => onRemove(index);

  // The state is the only content of its column (and of the frame of a
  // single-asset field)
  if (state === 'loading') {
    return (
      <div className={s.cell}>
        <LoadingAsset placement="inline" />
      </div>
    );
  }
  if (state === 'failed') {
    return (
      <div className={s.cell}>
        <FailedAsset
          placement="inline"
          disabled={disabled}
          onRemove={handleRemove}
        />
      </div>
    );
  }

  const data = resolveCardData(item, upload);
  const handleChange = (change: Partial<MediaLayoutItem>) =>
    onChange(index, change);

  return (
    <div className={s.cell}>
      <AssetCard
        item={item}
        data={data}
        disabled={disabled}
        onReplace={onReplace}
        onEditMetadata={() => onEditMetadata(index)}
        onRemove={handleRemove}
      />
      {/* Its own box: the last field of the box drops its bottom margin */}
      <div>
        <CropFields
          value={item}
          originalWidth={data.originalWidth}
          originalHeight={data.originalHeight}
          widthOptions={widthOptions}
          disabled={disabled}
          onChange={handleChange}
        />
        <AssetOptionFields
          value={item}
          enableCssClass={enableCssClass}
          enableLazyLoading={enableLazyLoading}
          disabled={disabled}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}

export default memo(AssetItem);
