import { Button, Dropdown, DropdownMenu, DropdownOption, Spinner } from 'datocms-react-ui';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import type { MediaLayoutItem } from '../../types';
import { calculateOutputHeight, getEffectiveRatio, formatDimensions } from '../../utils/aspectRatio';
import { useUploadData } from '../../hooks/useUploadData';
import { ASPECT_RATIO_OPTIONS, WIDTH_OPTIONS } from '../../constants';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
  item: MediaLayoutItem;
  onSelectAsset: () => void;
  onClear: () => void;
};

export default function SingleAssetEditor({
  ctx,
  item,
  onSelectAsset,
  onClear,
}: Props) {
  // Only fetch if url is missing (legacy data)
  const needsFetch = !item.url;
  const { upload, loading, error } = useUploadData(ctx, item.uploadId, !needsFetch);

  const handleLayoutChange = (newLayout: Partial<MediaLayoutItem>) => {
    const merged = { ...item, ...newLayout };
    const height = calculateOutputHeight(
      merged.width,
      merged.aspectRatio,
      merged.customAspectRatio,
      merged.originalWidth,
      merged.originalHeight
    );
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
      ctx.locale
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

  if (needsFetch && loading) {
    return (
      <div className={s.loading}>
        <Spinner size={24} />
      </div>
    );
  }

  if (needsFetch && (error || !upload)) {
    return (
      <div className={s.error}>
        <span>Failed to load asset</span>
        <Button buttonSize="xs" onClick={onClear}>Remove</Button>
      </div>
    );
  }

  // Use stored data or fetched data
  const url = item.url || upload?.attributes.url || '';
  const filename = item.filename || upload?.attributes.filename || '';
  const format = item.format ?? upload?.attributes.format ?? null;

  const isImage = format && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'].includes(format.toLowerCase());

  const focalX = item.focalPoint ? item.focalPoint.x * 100 : 50;
  const focalY = item.focalPoint ? item.focalPoint.y * 100 : 50;
  const ratio = getEffectiveRatio(item.aspectRatio, item.customAspectRatio, item.originalWidth, item.originalHeight);

  const aspectLabel = item.aspectRatio === 'custom'
    ? item.customAspectRatio
    : ASPECT_RATIO_OPTIONS.find(o => o.value === item.aspectRatio)?.label.split(' ')[0] || item.aspectRatio;

  const widthLabel = WIDTH_OPTIONS.find(o => o.value === item.width)?.label || `${item.width}px`;

  return (
    <div className={s.container}>
      <div className={s.thumbnail}>
        {isImage && url ? (
          <div
            className={s.thumbnailInner}
            style={{
              '--aspect-ratio': ratio || 1,
              '--focal-x': `${focalX}%`,
              '--focal-y': `${focalY}%`,
            } as React.CSSProperties}
          >
            <img src={`${url}?auto=format&w=200&fit=crop`} alt="" />
          </div>
        ) : (
          <div className={s.filePlaceholder}>
            {format?.toUpperCase() || 'FILE'}
          </div>
        )}
      </div>

      <div className={s.details}>
        <div className={s.info}>
          <span className={s.filename}>{filename}</span>
          {ratio && ratio > 0 && (
            <span className={s.dimensions}>{formatDimensions(item.width, ratio)}</span>
          )}
        </div>

        <div className={s.controls}>
          <Dropdown
            renderTrigger={({ onClick }) => (
              <button type="button" className={s.controlButton} onClick={onClick} disabled={ctx.disabled}>
                {aspectLabel}
              </button>
            )}
          >
            <DropdownMenu>
              {ASPECT_RATIO_OPTIONS.filter(o => o.value !== 'custom').map(opt => (
                <DropdownOption
                  key={opt.value}
                  onClick={() => handleLayoutChange({ aspectRatio: opt.value })}
                >
                  {opt.label}
                </DropdownOption>
              ))}
            </DropdownMenu>
          </Dropdown>

          <Dropdown
            renderTrigger={({ onClick }) => (
              <button type="button" className={s.controlButton} onClick={onClick} disabled={ctx.disabled}>
                {widthLabel}
              </button>
            )}
          >
            <DropdownMenu>
              {WIDTH_OPTIONS.map(opt => (
                <DropdownOption
                  key={opt.value}
                  onClick={() => handleLayoutChange({ width: opt.value })}
                >
                  {opt.label}
                </DropdownOption>
              ))}
            </DropdownMenu>
          </Dropdown>

          <Dropdown
            renderTrigger={({ onClick }) => (
              <button type="button" className={s.menuButton} onClick={onClick}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="8" cy="3" r="1.5" />
                  <circle cx="8" cy="8" r="1.5" />
                  <circle cx="8" cy="13" r="1.5" />
                </svg>
              </button>
            )}
          >
            <DropdownMenu>
              <DropdownOption onClick={onSelectAsset}>Replace</DropdownOption>
              <DropdownOption onClick={handleEditMetadata}>Edit metadata</DropdownOption>
              <DropdownOption onClick={onClear} red>Remove</DropdownOption>
            </DropdownMenu>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}
