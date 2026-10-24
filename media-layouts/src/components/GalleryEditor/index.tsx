import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import Pill from 'datocms-react-ui/Pill';
import { useCallback } from 'react';
import { useCountLabel } from '../../hooks/useCountLabel';
import { AddIcon } from '../../icons';
import type {
  MediaLayoutItem,
  MultipleFieldValue,
  WidthOption,
} from '../../types';
import { calculateOutputHeight } from '../../utils/aspectRatio';
import AssetItem, { AssetGrid } from '../AssetCard';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
  items: MultipleFieldValue;
  onAddAsset: () => void;
  widthOptions: WidthOption[];
  enableCssClass: boolean;
  enableLazyLoading: boolean;
};

/** The React key of an item */
function itemKey(item: MediaLayoutItem, index: number): string {
  return item._itemId ?? `${item.uploadId}-${index}`;
}

/**
 * The assets of a gallery field: a grid of cards, each with its crop, width
 * and options under it, then "Add assets" and the count. With no assets,
 * the empty slot shows in the place of the grid.
 */
export default function GalleryEditor({
  ctx,
  items,
  onAddAsset,
  widthOptions,
  enableCssClass,
  enableLazyLoading,
}: Props) {
  const formatCount = useCountLabel();
  const handleLayoutChange = useCallback(
    (index: number, newLayout: Partial<MediaLayoutItem>) => {
      const merged = { ...items[index], ...newLayout };
      const height =
        calculateOutputHeight(
          merged.width,
          merged.aspectRatio,
          merged.customAspectRatio,
          merged.originalWidth,
          merged.originalHeight,
        ) || merged.height;
      const newItems = [...items];
      newItems[index] = { ...merged, height };
      ctx.setFieldValue(ctx.fieldPath, JSON.stringify(newItems));
    },
    [items, ctx],
  );

  const handleRemove = useCallback(
    (index: number) => {
      const newItems = items.filter((_, i) => i !== index);
      ctx.setFieldValue(ctx.fieldPath, JSON.stringify(newItems));
    },
    [items, ctx],
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
          poster_time: null,
        },
        ctx.locale,
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
    [items, ctx],
  );

  if (items.length === 0) {
    return (
      <EmptySlot
        message="No assets yet"
        action={
          ctx.disabled
            ? undefined
            : { label: 'Add assets', onClick: onAddAsset }
        }
      />
    );
  }

  return (
    <div className={s.editor}>
      <AssetGrid>
        {items.map((item, index) => (
          <AssetItem
            key={itemKey(item, index)}
            ctx={ctx}
            item={item}
            index={index}
            widthOptions={widthOptions}
            enableCssClass={enableCssClass}
            enableLazyLoading={enableLazyLoading}
            disabled={ctx.disabled}
            onChange={handleLayoutChange}
            onRemove={handleRemove}
            onEditMetadata={handleEditMetadata}
          />
        ))}
      </AssetGrid>
      <div className={s.footer}>
        {!ctx.disabled && (
          <Button icon={AddIcon} label="Add assets" onClick={onAddAsset} />
        )}
        <Pill>{formatCount(items.length, 'asset', 'assets')}</Pill>
      </div>
    </div>
  );
}
