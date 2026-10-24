import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { useCallback } from 'react';
import type { MediaLayoutItem, WidthOption } from '../../types';
import { calculateOutputHeight } from '../../utils/aspectRatio';
import AssetItem, { AssetGrid } from '../AssetCard';

type Props = {
  ctx: RenderFieldExtensionCtx;
  item: MediaLayoutItem;
  onSelectAsset: () => void;
  onClear: () => void;
  widthOptions: WidthOption[];
  enableCssClass: boolean;
  enableLazyLoading: boolean;
};

/**
 * The asset of a single-asset field: its card in the first column of the
 * grid of a gallery, with its crop, width and options under it.
 */
export default function SingleAssetEditor({
  ctx,
  item,
  onSelectAsset,
  onClear,
  widthOptions,
  enableCssClass,
  enableLazyLoading,
}: Props) {
  const handleLayoutChange = useCallback(
    (_index: number, newLayout: Partial<MediaLayoutItem>) => {
      const merged = { ...item, ...newLayout };
      const height =
        calculateOutputHeight(
          merged.width,
          merged.aspectRatio,
          merged.customAspectRatio,
          merged.originalWidth,
          merged.originalHeight,
        ) || merged.height;
      const updatedItem: MediaLayoutItem = { ...merged, height };
      ctx.setFieldValue(ctx.fieldPath, JSON.stringify(updatedItem));
    },
    [ctx, item],
  );

  const handleEditMetadata = useCallback(async () => {
    const result = await ctx.editUploadMetadata(
      {
        upload_id: item.uploadId,
        alt: item.alt,
        title: item.title,
        focal_point: item.focalPoint,
        custom_data: {},
        poster_time: null,
      },
      ctx.locale,
    );
    if (result) {
      const updatedItem: MediaLayoutItem = {
        ...item,
        alt: result.alt,
        title: result.title,
        focalPoint: result.focal_point,
      };
      ctx.setFieldValue(ctx.fieldPath, JSON.stringify(updatedItem));
    }
  }, [ctx, item]);

  return (
    <AssetGrid>
      <AssetItem
        ctx={ctx}
        item={item}
        index={0}
        widthOptions={widthOptions}
        enableCssClass={enableCssClass}
        enableLazyLoading={enableLazyLoading}
        disabled={ctx.disabled}
        onChange={handleLayoutChange}
        onRemove={onClear}
        onEditMetadata={handleEditMetadata}
        onReplace={onSelectAsset}
      />
    </AssetGrid>
  );
}
