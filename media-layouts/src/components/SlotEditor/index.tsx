import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { RenderFieldExtensionCtx, Upload } from 'datocms-plugin-sdk';
import type {
  LayoutConfig,
  LayoutSlot,
  SlotAssignment,
  WidthOption,
} from '../../types';
import { calculateOutputHeight, getEffectiveRatio } from '../../utils/aspectRatio';
import SlotCard from './SlotCard';
import s from './styles.module.css';

const MASONRY_ROW_HEIGHT = 8;

type Props = {
  ctx: RenderFieldExtensionCtx;
  layoutConfig: LayoutConfig;
  assignments: SlotAssignment[];
  widthOptions: WidthOption[];
  enableCssClass: boolean;
  enableLazyLoading: boolean;
  onAssignmentsChange: (assignments: SlotAssignment[]) => void;
};

export default function SlotEditor({
  ctx,
  layoutConfig,
  assignments,
  widthOptions,
  enableCssClass,
  enableLazyLoading,
  onAssignmentsChange,
}: Props) {
  const isMasonry = layoutConfig.layoutStyle === 'masonry';
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridMetrics, setGridMetrics] = useState({
    columnWidth: 0,
    gap: 0,
  });
  const getAssignmentForSlot = useCallback(
    (slotId: string) => assignments.find((a) => a.slotId === slotId),
    [assignments]
  );

  const handleSelectAssetForSlot = useCallback(
    async (slot: LayoutSlot) => {
      const result = await ctx.selectUpload({ multiple: false });
      if (!result) return;

      const upload = result as Upload;
      const attrs = upload.attributes;
      const metadata = attrs.default_field_metadata[ctx.locale] || {};

      const height = calculateOutputHeight(
        slot.width,
        slot.aspectRatio,
        slot.customAspectRatio,
        attrs.width,
        attrs.height
      );

      const newAssignment: SlotAssignment = {
        slotId: slot.id,
        uploadId: upload.id,
        url: attrs.url,
        filename: attrs.filename,
        format: attrs.format ?? null,
        size: attrs.size,
        alt: metadata.alt || null,
        title: metadata.title || null,
        ...(enableCssClass ? { cssClass: '' } : {}),
        ...(enableLazyLoading ? { lazyLoading: false } : {}),
        focalPoint: metadata.focal_point || null,
        aspectRatio: slot.aspectRatio,
        customAspectRatio: slot.customAspectRatio,
        width: slot.width,
        height,
        originalWidth: attrs.width,
        originalHeight: attrs.height,
      };

      // Replace existing assignment for this slot or add new
      const filteredAssignments = assignments.filter(
        (a) => a.slotId !== slot.id
      );
      onAssignmentsChange([...filteredAssignments, newAssignment]);
    },
    [ctx, assignments, onAssignmentsChange, enableCssClass, enableLazyLoading]
  );

  const handleAssignmentChange = useCallback(
    (slotId: string, updates: Partial<SlotAssignment>) => {
      const assignment = getAssignmentForSlot(slotId);
      if (!assignment) return;
      const nextAssignments = assignments.map((item) =>
        item.slotId === slotId ? { ...assignment, ...updates } : item
      );
      onAssignmentsChange(nextAssignments);
    },
    [assignments, getAssignmentForSlot, onAssignmentsChange]
  );

  const handleRemoveAssetFromSlot = useCallback(
    (slotId: string) => {
      onAssignmentsChange(assignments.filter((a) => a.slotId !== slotId));
    },
    [assignments, onAssignmentsChange]
  );

  const handleEditMetadata = useCallback(
    async (slot: LayoutSlot) => {
      const assignment = getAssignmentForSlot(slot.id);
      if (!assignment) return;

      const result = await ctx.editUploadMetadata(
        {
          upload_id: assignment.uploadId,
          alt: assignment.alt,
          title: assignment.title,
          focal_point: assignment.focalPoint,
          custom_data: {},
        },
        ctx.locale
      );

      if (result) {
        const updatedAssignments = assignments.map((a) =>
          a.slotId === slot.id
            ? {
                ...a,
                alt: result.alt,
                title: result.title,
                focalPoint: result.focal_point,
              }
            : a
        );
        onAssignmentsChange(updatedAssignments);
      }
    },
    [ctx, assignments, getAssignmentForSlot, onAssignmentsChange]
  );

  const getSlotSpan = useCallback(
    (slot: LayoutSlot) => {
      const rowSpan =
        typeof slot.rowSpan === 'number' && slot.rowSpan > 0 ? slot.rowSpan : 1;
      const colSpan =
        typeof slot.colSpan === 'number' && slot.colSpan > 0 ? slot.colSpan : 1;
      return {
        rowSpan: Math.min(rowSpan, Math.max(1, layoutConfig.rows - slot.row)),
        colSpan: Math.min(colSpan, Math.max(1, layoutConfig.columns - slot.col)),
      };
    },
    [layoutConfig.columns, layoutConfig.rows]
  );

  useLayoutEffect(() => {
    if (!gridRef.current) return;
    const element = gridRef.current;

    const computeMetrics = () => {
      const style = getComputedStyle(element);
      const gap = Number.parseFloat(style.columnGap || style.gap || '0') || 0;
      const width = element.clientWidth;
      const columnWidth =
        layoutConfig.columns > 0
          ? (width - gap * (layoutConfig.columns - 1)) / layoutConfig.columns
          : 0;
      setGridMetrics({
        columnWidth,
        gap,
      });
    };

    computeMetrics();
    const observer = new ResizeObserver(() => computeMetrics());
    observer.observe(element);
    return () => observer.disconnect();
  }, [layoutConfig.columns, isMasonry]);

  const getMasonryRowSpan = useCallback(
    (slot: LayoutSlot) => {
      const ratio =
        getEffectiveRatio(slot.aspectRatio, slot.customAspectRatio) ?? 1;
      const safeRatio = ratio > 0 ? ratio : 1;
      const colSpan =
        typeof slot.colSpan === 'number' && slot.colSpan > 0 ? slot.colSpan : 1;
      const columnWidth = gridMetrics.columnWidth;
      if (!columnWidth || columnWidth <= 0) return 1;
      const gap = gridMetrics.gap;
      const itemWidth = columnWidth * colSpan + gap * (colSpan - 1);
      const height = itemWidth / safeRatio;
      return Math.max(
        1,
        Math.ceil((height + gap) / (MASONRY_ROW_HEIGHT + gap))
      );
    },
    [gridMetrics.columnWidth, gridMetrics.gap]
  );

  // Sort slots by row and column for display
  const sortedSlots = [...layoutConfig.slots].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  const displaySlots = isMasonry ? layoutConfig.slots : sortedSlots;

  if (sortedSlots.length === 0) {
    return (
      <div className={s.emptyGrid}>
        No slots configured. Please configure slots in the field settings.
      </div>
    );
  }

  return (
    <div className={s.container}>
      <div
        className={s.grid}
        data-layout={isMasonry ? 'masonry' : 'grid'}
        ref={gridRef}
        style={
          isMasonry
            ? {
                gridTemplateColumns: `repeat(${layoutConfig.columns}, minmax(0, 1fr))`,
                gridAutoRows: `${MASONRY_ROW_HEIGHT}px`,
              }
            : {
                gridTemplateColumns: `repeat(${layoutConfig.columns}, minmax(0, 1fr))`,
              }
        }
      >
        {displaySlots.map((slot) => {
          const { rowSpan, colSpan } = getSlotSpan(slot);
          const masonryRowSpan = isMasonry ? getMasonryRowSpan(slot) : rowSpan;
          const masonryColSpan =
            typeof slot.colSpan === 'number' && slot.colSpan > 0
              ? Math.min(slot.colSpan, layoutConfig.columns)
              : 1;
          return (
            <div
              key={slot.id}
              className={s.slotCell}
              style={{
                gridColumn: isMasonry
                  ? `span ${masonryColSpan}`
                  : `${slot.col + 1} / span ${colSpan}`,
                gridRow: isMasonry
                  ? `span ${masonryRowSpan}`
                  : `${slot.row + 1} / span ${rowSpan}`,
              }}
            >
              <SlotCard
                ctx={ctx}
                slot={slot}
                assignment={getAssignmentForSlot(slot.id)}
                widthOptions={widthOptions}
                enableCssClass={enableCssClass}
                enableLazyLoading={enableLazyLoading}
                disabled={ctx.disabled}
                onSelectAsset={() => handleSelectAssetForSlot(slot)}
                onRemoveAsset={() => handleRemoveAssetFromSlot(slot.id)}
                onEditMetadata={() => handleEditMetadata(slot)}
                onAssignmentChange={(updates) =>
                  handleAssignmentChange(slot.id, updates)
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
