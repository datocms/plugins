import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import type { MediaLayoutItem, WidthOption } from '../../types';
import { calculateOutputHeight } from '../../utils/aspectRatio';
import AssetCard from '../AssetCard';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
  item: MediaLayoutItem;
  onSelectAsset: () => void;
  onClear: () => void;
  widthOptions: WidthOption[];
  enableCssClass: boolean;
  enableLazyLoading: boolean;
};

export default function SingleAssetEditor({
  ctx,
  item,
  onSelectAsset,
  onClear,
  widthOptions,
  enableCssClass,
  enableLazyLoading,
}: Props) {
  const handleLayoutChange = (newLayout: Partial<MediaLayoutItem>) => {
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
  };

  const handleEditMetadata = async () => {
    const result = await ctx.editUploadMetadata(
      {
        upload_id: item.uploadId,
        alt: item.alt,
        title: item.title,
        focal_point: item.focalPoint,
        custom_data: {},
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
  };

  return (
    <div className={s.singleEditor}>
      <div className={s.header}>
        <div className={s.headerInfo}>
          <span className={s.headerTitle}>Asset</span>
          <span className={s.headerCount}>1 asset</span>
        </div>
      </div>

      <AssetCard
        ctx={ctx}
        item={item}
        onLayoutChange={handleLayoutChange}
        onRemove={onClear}
        onEditMetadata={handleEditMetadata}
        onReplace={onSelectAsset}
        widthOptions={widthOptions}
        enableCssClass={enableCssClass}
        enableLazyLoading={enableLazyLoading}
        disabled={ctx.disabled}
      />
    </div>
  );
}
