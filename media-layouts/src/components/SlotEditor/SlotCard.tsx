import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Spinner } from 'datocms-react-ui';
import type { LayoutSlot, SlotAssignment } from '../../types';
import {
  getEffectiveRatio,
  formatDimensions,
} from '../../utils/aspectRatio';
import { ASPECT_RATIO_OPTIONS } from '../../constants';
import { useUploadData } from '../../hooks/useUploadData';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
  slot: LayoutSlot;
  assignment: SlotAssignment | undefined;
  disabled?: boolean;
  onSelectAsset: () => void;
  onRemoveAsset: () => void;
  onEditMetadata: () => void;
};

export default function SlotCard({
  ctx,
  slot,
  assignment,
  disabled,
  onSelectAsset,
  onRemoveAsset,
  onEditMetadata,
}: Props) {
  const aspectLabel =
    slot.aspectRatio === 'custom'
      ? slot.customAspectRatio
      : ASPECT_RATIO_OPTIONS.find((o) => o.value === slot.aspectRatio)?.label.split(
          ' '
        )[0] || slot.aspectRatio;

  const isEmpty = !assignment;
  const cardClasses = [
    s.slotCard,
    isEmpty && s.isEmpty,
    slot.required && s.isRequired,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cardClasses}>
      <div className={s.slotHeader}>
        <div>
          <div className={s.slotLabel}>{slot.label}</div>
          <div className={s.slotMeta}>
            {aspectLabel} • {slot.width}px
          </div>
        </div>
        {slot.required && <span className={s.requiredBadge}>Required</span>}
      </div>

      <div className={s.slotContent}>
        {isEmpty ? (
          <div className={s.emptySlot}>
            <div className={s.emptyIcon}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <div className={s.emptyText}>No asset selected</div>
            <button
              type="button"
              className={s.selectButton}
              onClick={onSelectAsset}
              disabled={disabled}
            >
              Select asset
            </button>
          </div>
        ) : (
          <FilledSlotContent
            ctx={ctx}
            assignment={assignment}
            slot={slot}
            disabled={disabled}
            onSelectAsset={onSelectAsset}
            onRemoveAsset={onRemoveAsset}
            onEditMetadata={onEditMetadata}
          />
        )}
      </div>
    </div>
  );
}

type FilledSlotContentProps = {
  ctx: RenderFieldExtensionCtx;
  assignment: SlotAssignment;
  slot: LayoutSlot;
  disabled?: boolean;
  onSelectAsset: () => void;
  onRemoveAsset: () => void;
  onEditMetadata: () => void;
};

function FilledSlotContent({
  ctx,
  assignment,
  slot,
  disabled,
  onSelectAsset,
  onRemoveAsset,
  onEditMetadata,
}: FilledSlotContentProps) {
  const needsFetch =
    !assignment.url ||
    !assignment.filename ||
    assignment.format === null ||
    assignment.format === undefined ||
    (slot.aspectRatio === 'original' &&
      (!assignment.originalWidth || !assignment.originalHeight));

  const { upload, loading, error } = useUploadData(
    ctx,
    assignment.uploadId,
    !needsFetch
  );

  if (needsFetch && loading && !assignment.url) {
    return (
      <div className={s.loadingState}>
        <Spinner size={20} />
      </div>
    );
  }

  if (needsFetch && (error || !upload) && !assignment.url) {
    return (
      <div className={s.errorState}>
        <span>Failed to load asset</span>
        <button
          type="button"
          className={s.removeErrorButton}
          onClick={onRemoveAsset}
        >
          Remove
        </button>
      </div>
    );
  }

  const url = assignment.url || upload?.attributes.url || '';
  const filename = assignment.filename || upload?.attributes.filename || '';
  const originalWidth = assignment.originalWidth ?? upload?.attributes.width ?? null;
  const originalHeight = assignment.originalHeight ?? upload?.attributes.height ?? null;

  const formatFromPath = (value: string) => {
    const cleaned = value.split('?')[0];
    const parts = cleaned.split('.');
    if (parts.length < 2) return null;
    return parts[parts.length - 1].toLowerCase();
  };

  const format =
    assignment.format ??
    upload?.attributes.format ??
    formatFromPath(url || filename);

  const normalizedFormat = format ? format.toLowerCase() : null;
  const isImage =
    !!normalizedFormat &&
    (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'].includes(
      normalizedFormat
    ) ||
      normalizedFormat.startsWith('image/'));

  const ratio = getEffectiveRatio(
    slot.aspectRatio,
    slot.customAspectRatio,
    originalWidth,
    originalHeight
  );

  const aspectStyle =
    ratio && ratio > 0
      ? { aspectRatio: String(ratio) }
      : { minHeight: '80px' };

  return (
    <div className={s.filledSlot}>
      <div className={s.thumbnailContainer} style={aspectStyle}>
        {isImage ? (
          <img
            src={`${url}?auto=format&w=400&fit=crop`}
            alt=""
            className={s.thumbnail}
          />
        ) : (
          <div className={s.filePlaceholder}>
            {format ? format.toUpperCase() : 'FILE'}
          </div>
        )}

        {!disabled && (
          <div className={s.slotOverlay}>
            <button
              type="button"
              className={s.overlayButton}
              onClick={onSelectAsset}
              title="Replace"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
            </button>
            <button
              type="button"
              className={s.overlayButton}
              onClick={onEditMetadata}
              title="Edit metadata"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              type="button"
              className={`${s.overlayButton} ${s.danger}`}
              onClick={onRemoveAsset}
              title="Remove"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className={s.assetInfo}>
        <span className={s.filename}>{filename || 'Untitled'}</span>
        {ratio && ratio > 0 && (
          <span className={s.dimensions}>{formatDimensions(slot.width, ratio)}</span>
        )}
      </div>
    </div>
  );
}
