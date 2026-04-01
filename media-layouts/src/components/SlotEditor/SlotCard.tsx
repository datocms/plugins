import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Spinner } from 'datocms-react-ui';
import { ASPECT_RATIO_OPTIONS } from '../../constants';
import { useUploadData } from '../../hooks/useUploadData';
import type { LayoutSlot, SlotAssignment, WidthOption } from '../../types';
import { formatDimensions, getEffectiveRatio } from '../../utils/aspectRatio';
import {
  getFormatLabel,
  isImageFormat,
  resolveFormat,
} from '../../utils/upload';
import { getWidthLabel, resolveWidthValue } from '../../utils/width';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
  slot: LayoutSlot;
  assignment: SlotAssignment | undefined;
  widthOptions: WidthOption[];
  enableCssClass: boolean;
  enableLazyLoading: boolean;
  disabled?: boolean;
  onSelectAsset: () => void;
  onRemoveAsset: () => void;
  onEditMetadata: () => void;
  onAssignmentChange: (updates: Partial<SlotAssignment>) => void;
};

export default function SlotCard({
  ctx,
  slot,
  assignment,
  widthOptions,
  enableCssClass,
  enableLazyLoading,
  disabled,
  onSelectAsset,
  onRemoveAsset,
  onEditMetadata,
  onAssignmentChange,
}: Props) {
  const aspectLabel =
    slot.aspectRatio === 'custom'
      ? slot.customAspectRatio
      : ASPECT_RATIO_OPTIONS.find(
          (o) => o.value === slot.aspectRatio,
        )?.label.split(' ')[0] || slot.aspectRatio;

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
          <div className={s.slotLabel}>{slot.label || 'Untitled'}</div>
          <div className={s.slotMeta}>
            {aspectLabel} • {getWidthLabel(slot.width, widthOptions)}
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
            enableCssClass={enableCssClass}
            enableLazyLoading={enableLazyLoading}
            disabled={disabled}
            onSelectAsset={onSelectAsset}
            onRemoveAsset={onRemoveAsset}
            onEditMetadata={onEditMetadata}
            onAssignmentChange={onAssignmentChange}
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
  enableCssClass: boolean;
  enableLazyLoading: boolean;
  disabled?: boolean;
  onSelectAsset: () => void;
  onRemoveAsset: () => void;
  onEditMetadata: () => void;
  onAssignmentChange: (updates: Partial<SlotAssignment>) => void;
};

type ResolvedAssetData = {
  url: string;
  filename: string;
  originalWidth: number | null;
  originalHeight: number | null;
  format: string | null;
};

function resolveAssetData(
  assignment: SlotAssignment,
  upload: {
    attributes: {
      url?: string;
      filename?: string;
      width?: number;
      height?: number;
      format?: string;
    };
  } | null,
): ResolvedAssetData {
  const url = assignment.url || upload?.attributes.url || '';
  const filename = assignment.filename || upload?.attributes.filename || '';
  const originalWidth =
    assignment.originalWidth ?? upload?.attributes.width ?? null;
  const originalHeight =
    assignment.originalHeight ?? upload?.attributes.height ?? null;
  const format = resolveFormat({
    format: assignment.format ?? upload?.attributes.format ?? null,
    url,
    filename,
  });
  return { url, filename, originalWidth, originalHeight, format };
}

function SlotOverlayButtons({
  onSelectAsset,
  onEditMetadata,
  onRemoveAsset,
}: {
  onSelectAsset: () => void;
  onEditMetadata: () => void;
  onRemoveAsset: () => void;
}) {
  return (
    <div className={s.slotOverlay}>
      <button
        type="button"
        className={s.overlayButton}
        onClick={onSelectAsset}
        title="Replace"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
      </button>
      <button
        type="button"
        className={s.overlayButton}
        onClick={onEditMetadata}
        title="Edit metadata"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
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
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      </button>
    </div>
  );
}

function AssetExtraControls({
  enableCssClass,
  enableLazyLoading,
  cssClassValue,
  lazyLoadingValue,
  disabled,
  onAssignmentChange,
}: {
  enableCssClass: boolean;
  enableLazyLoading: boolean;
  cssClassValue: string;
  lazyLoadingValue: boolean;
  disabled?: boolean;
  onAssignmentChange: (updates: Partial<SlotAssignment>) => void;
}) {
  return (
    <div className={s.assetOptions}>
      {enableCssClass && (
        <input
          type="text"
          className={s.cssClassInput}
          placeholder="CSS class"
          value={cssClassValue}
          onChange={(e) => onAssignmentChange({ cssClass: e.target.value })}
          disabled={disabled}
        />
      )}
      {enableLazyLoading && (
        <label
          className={
            disabled ? `${s.lazyToggle} ${s.toggleDisabled}` : s.lazyToggle
          }
        >
          <input
            type="checkbox"
            checked={lazyLoadingValue}
            onChange={(e) =>
              onAssignmentChange({ lazyLoading: e.target.checked })
            }
            disabled={disabled}
          />
          <span className={s.toggleTrack} aria-hidden="true" />
          <span className={s.toggleLabel}>Lazy</span>
        </label>
      )}
    </div>
  );
}

function determineNeedsFetch(
  assignment: SlotAssignment,
  slot: LayoutSlot,
): boolean {
  const baseFormat = resolveFormat({
    format: assignment.format,
    url: assignment.url,
    filename: assignment.filename,
  });
  const needsOriginalWidth =
    slot.width === 'original' || slot.aspectRatio === 'original';
  const needsOriginalHeight = slot.aspectRatio === 'original';
  return (
    !assignment.url ||
    !assignment.filename ||
    !baseFormat ||
    (needsOriginalWidth && !assignment.originalWidth) ||
    (needsOriginalHeight && !assignment.originalHeight)
  );
}

type FilledSlotReadyProps = {
  assignment: SlotAssignment;
  slot: LayoutSlot;
  upload: {
    attributes: {
      url?: string;
      filename?: string;
      width?: number;
      height?: number;
      format?: string;
    };
  } | null;
  enableCssClass: boolean;
  enableLazyLoading: boolean;
  disabled?: boolean;
  onSelectAsset: () => void;
  onRemoveAsset: () => void;
  onEditMetadata: () => void;
  onAssignmentChange: (updates: Partial<SlotAssignment>) => void;
};

function FilledSlotReady({
  assignment,
  slot,
  upload,
  enableCssClass,
  enableLazyLoading,
  disabled,
  onSelectAsset,
  onRemoveAsset,
  onEditMetadata,
  onAssignmentChange,
}: FilledSlotReadyProps) {
  const { url, filename, originalWidth, originalHeight, format } =
    resolveAssetData(assignment, upload);

  const isImage = isImageFormat(format);
  const formatLabel = getFormatLabel(format);

  const ratio = getEffectiveRatio(
    slot.aspectRatio,
    slot.customAspectRatio,
    originalWidth,
    originalHeight,
  );
  const resolvedWidth = resolveWidthValue(slot.width, originalWidth);
  const cssClassValue = assignment.cssClass ?? '';
  const lazyLoadingValue = assignment.lazyLoading ?? false;
  const showExtraControls = enableCssClass || enableLazyLoading;

  const aspectStyle =
    ratio && ratio > 0 ? { aspectRatio: String(ratio) } : { minHeight: '80px' };

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
            {formatLabel?.toUpperCase() || 'FILE'}
          </div>
        )}

        {!disabled && (
          <SlotOverlayButtons
            onSelectAsset={onSelectAsset}
            onEditMetadata={onEditMetadata}
            onRemoveAsset={onRemoveAsset}
          />
        )}
      </div>

      <div className={s.assetInfo}>
        <span className={s.filename} title={filename || 'Untitled'}>
          {filename || 'Untitled'}
        </span>
        {ratio && ratio > 0 && resolvedWidth && (
          <span className={s.dimensions}>
            {formatDimensions(resolvedWidth, ratio)}
          </span>
        )}
      </div>

      {showExtraControls && (
        <AssetExtraControls
          enableCssClass={enableCssClass}
          enableLazyLoading={enableLazyLoading}
          cssClassValue={cssClassValue}
          lazyLoadingValue={lazyLoadingValue}
          disabled={disabled}
          onAssignmentChange={onAssignmentChange}
        />
      )}
    </div>
  );
}

function FilledSlotContent({
  ctx,
  assignment,
  slot,
  enableCssClass,
  enableLazyLoading,
  disabled,
  onSelectAsset,
  onRemoveAsset,
  onEditMetadata,
  onAssignmentChange,
}: FilledSlotContentProps) {
  const needsFetch = determineNeedsFetch(assignment, slot);

  const { upload, loading, error } = useUploadData(
    ctx,
    assignment.uploadId,
    !needsFetch,
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

  return (
    <FilledSlotReady
      assignment={assignment}
      slot={slot}
      upload={upload}
      enableCssClass={enableCssClass}
      enableLazyLoading={enableLazyLoading}
      disabled={disabled}
      onSelectAsset={onSelectAsset}
      onRemoveAsset={onRemoveAsset}
      onEditMetadata={onEditMetadata}
      onAssignmentChange={onAssignmentChange}
    />
  );
}
