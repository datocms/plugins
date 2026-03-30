import { Button } from 'datocms-react-ui';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { useCallback } from 'react';
import type { MediaLayoutItem, MultipleFieldValue, WidthOption } from '../../types';
import { calculateOutputHeight } from '../../utils/aspectRatio';
import AssetCard from '../AssetCard';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
  items: MultipleFieldValue;
  onAddAsset: () => void;
  widthOptions: WidthOption[];
  enableCssClass: boolean;
  enableLazyLoading: boolean;
};

export default function GalleryEditor({
  ctx,
  items,
  onAddAsset,
  widthOptions,
  enableCssClass,
  enableLazyLoading,
}: Props) {
  const assetCountLabel = `${items.length} asset${items.length === 1 ? '' : 's'}`;

  const handleLayoutChange = useCallback(
    (index: number, newLayout: Partial<MediaLayoutItem>) => {
      const merged = { ...items[index], ...newLayout };
      const height = calculateOutputHeight(
        merged.width,
        merged.aspectRatio,
        merged.customAspectRatio,
        merged.originalWidth,
        merged.originalHeight
      ) || merged.height;
      const newItems = [...items];
      newItems[index] = { ...merged, height };
      ctx.setFieldValue(ctx.fieldPath, JSON.stringify(newItems));
    },
    [items, ctx]
  );

  const handleRemove = useCallback(
    (index: number) => {
      const newItems = items.filter((_, i) => i !== index);
      ctx.setFieldValue(ctx.fieldPath, JSON.stringify(newItems));
    },
    [items, ctx]
  );

  const handleEditMetadata = useCallback(
    async (index: number) => {
      const item = items[index];
      const result = await ctx.editUploadMetadata(
        {
          upload_id: item.uploadId,
          alt: item.alt,
          title: item.title,
          focal_point: item.focalPoint,
          custom_data: {},
        },
        ctx.locale
      );
      if (result) {
        const newItems = [...items];
        newItems[index] = {
          ...item,
          alt: result.alt,
          title: result.title,
          focalPoint: result.focal_point,
        };
        ctx.setFieldValue(ctx.fieldPath, JSON.stringify(newItems));
      }
    },
    [items, ctx]
  );

  return (
    <div className={s.galleryEditor}>
      <div className={s.header}>
        <div className={s.headerInfo}>
          <span className={s.headerTitle}>Assets</span>
          <span className={s.headerCount}>{assetCountLabel}</span>
        </div>
        <Button
          onClick={onAddAsset}
          disabled={ctx.disabled}
          buttonSize="xs"
          buttonType="muted"
        >
          + Add assets
        </Button>
      </div>

      <div className={s.assetList}>
        {items.map((item, index) => (
          <AssetCard
            key={`${item.uploadId}-${index}`}
            ctx={ctx}
            item={item}
            onLayoutChange={(layout) => handleLayoutChange(index, layout)}
            onRemove={() => handleRemove(index)}
            onEditMetadata={() => handleEditMetadata(index)}
            widthOptions={widthOptions}
            enableCssClass={enableCssClass}
            enableLazyLoading={enableLazyLoading}
            disabled={ctx.disabled}
          />
        ))}
      </div>
    </div>
  );
}
