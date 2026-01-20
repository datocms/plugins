import { Dropdown, DropdownMenu, DropdownOption, Spinner } from 'datocms-react-ui';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import type { MediaLayoutItem } from '../../types';
import { ASPECT_RATIO_OPTIONS, WIDTH_OPTIONS } from '../../constants';
import { getEffectiveRatio, formatDimensions } from '../../utils/aspectRatio';
import { useUploadData } from '../../hooks/useUploadData';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
  item: MediaLayoutItem;
  onLayoutChange: (layout: Partial<MediaLayoutItem>) => void;
  onRemove: () => void;
  onEditMetadata: () => void;
  disabled?: boolean;
};

export default function AssetCard({
  ctx,
  item,
  onLayoutChange,
  onRemove,
  onEditMetadata,
  disabled,
}: Props) {
  // Only fetch if url is missing (legacy data)
  const needsFetch = !item.url;
  const { upload, loading, error } = useUploadData(ctx, item.uploadId, !needsFetch);

  if (needsFetch && loading) {
    return (
      <div className={s.card}>
        <div className={s.loadingState}>
          <Spinner size={20} />
        </div>
      </div>
    );
  }

  if (needsFetch && (error || !upload)) {
    return (
      <div className={s.card}>
        <div className={s.errorState}>
          <span>Failed to load</span>
          <button type="button" className={s.removeButton} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    );
  }

  // Use stored data or fetched data
  const url = item.url || upload?.attributes.url || '';
  const filename = item.filename || upload?.attributes.filename || '';
  const format = item.format ?? upload?.attributes.format ?? null;

  const thumbnailUrl = url ? `${url}?auto=format&w=80&h=80&fit=crop` : '';
  const isImage = format && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'].includes(format.toLowerCase());

  const ratio = getEffectiveRatio(item.aspectRatio, item.customAspectRatio, item.originalWidth, item.originalHeight);

  const aspectLabel = item.aspectRatio === 'custom'
    ? item.customAspectRatio
    : ASPECT_RATIO_OPTIONS.find(o => o.value === item.aspectRatio)?.label.split(' ')[0] || item.aspectRatio;

  const widthLabel = WIDTH_OPTIONS.find(o => o.value === item.width)?.label || `${item.width}px`;

  return (
    <div className={s.card}>
      <div className={s.thumbnail}>
        {isImage && thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" />
        ) : (
          <div className={s.filePlaceholder}>
            {format?.toUpperCase() || 'FILE'}
          </div>
        )}
      </div>

      <div className={s.info}>
        <span className={s.filename}>{filename}</span>
        {ratio && ratio > 0 && (
          <span className={s.dimensions}>{formatDimensions(item.width, ratio)}</span>
        )}
      </div>

      <div className={s.controls}>
        <Dropdown
          renderTrigger={({ onClick }) => (
            <button type="button" className={s.controlButton} onClick={onClick} disabled={disabled}>
              {aspectLabel}
            </button>
          )}
        >
          <DropdownMenu>
            {ASPECT_RATIO_OPTIONS.filter(o => o.value !== 'custom').map(opt => (
              <DropdownOption
                key={opt.value}
                onClick={() => onLayoutChange({ aspectRatio: opt.value })}
              >
                {opt.label}
              </DropdownOption>
            ))}
          </DropdownMenu>
        </Dropdown>

        <Dropdown
          renderTrigger={({ onClick }) => (
            <button type="button" className={s.controlButton} onClick={onClick} disabled={disabled}>
              {widthLabel}
            </button>
          )}
        >
          <DropdownMenu>
            {WIDTH_OPTIONS.map(opt => (
              <DropdownOption
                key={opt.value}
                onClick={() => onLayoutChange({ width: opt.value })}
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
            <DropdownOption onClick={onEditMetadata}>Edit metadata</DropdownOption>
            <DropdownOption onClick={onRemove} red>Remove</DropdownOption>
          </DropdownMenu>
        </Dropdown>
      </div>
    </div>
  );
}
