import { ASPECT_RATIO_OPTIONS } from '../../constants';
import type { LayoutSlot } from '../../types';
import s from './styles.module.css';

type Props = {
  slot: LayoutSlot;
  isSelected: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};

export default function SlotItem({
  slot,
  isSelected,
  isDragging,
  isDragOver,
  onSelect,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: Props) {
  // Get the aspect ratio for visual preview
  const aspectOption = ASPECT_RATIO_OPTIONS.find(
    (opt) => opt.value === slot.aspectRatio
  );
  const aspectRatio = aspectOption?.ratio ?? 1;
  const aspectLabel = aspectOption?.label.split(' ')[0] || slot.aspectRatio;

  const slotClasses = [
    s.slotItem,
    isSelected && s.isSelected,
    slot.required && s.isRequired,
    isDragging && s.isDragging,
    isDragOver && s.isDragOver,
  ]
    .filter(Boolean)
    .join(' ');

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <div
      className={slotClasses}
      onClick={onSelect}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={s.slotPreview}
        style={{ aspectRatio: aspectRatio > 0 ? String(aspectRatio) : '1' }}
      >
        <div className={s.dragHandle}>
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </div>
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
        <span className={s.slotLabel}>{slot.label || 'Untitled'}</span>
        <span className={s.slotMeta}>
          {aspectLabel} · {slot.width}px
        </span>
      </div>

      <div className={s.slotOverlay}>
        <button
          type="button"
          className={s.overlayButton}
          onClick={handleEdit}
          title="Edit slot"
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
          onClick={handleDelete}
          title="Delete slot"
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
    </div>
  );
}
