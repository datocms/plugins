import { useCallback } from 'react';
import type { RenderFieldExtensionCtx, Upload } from 'datocms-plugin-sdk';
import type { LayoutConfig, LayoutSlot, SlotAssignment } from '../../types';
import { calculateOutputHeight } from '../../utils/aspectRatio';
import SlotCard from './SlotCard';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
  layoutConfig: LayoutConfig;
  assignments: SlotAssignment[];
  onAssignmentsChange: (assignments: SlotAssignment[]) => void;
};

export default function SlotEditor({
  ctx,
  layoutConfig,
  assignments,
  onAssignmentsChange,
}: Props) {
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
    [ctx, assignments, onAssignmentsChange]
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

  // Sort slots by row and column for display
  const sortedSlots = [...layoutConfig.slots].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  if (sortedSlots.length === 0) {
    return (
      <div className={s.emptyGrid}>
        No slots configured. Please configure slots in the field settings.
      </div>
    );
  }

  return (
    <div className={s.container}>
      <div className={s.grid} data-columns={layoutConfig.columns}>
        {sortedSlots.map((slot) => (
          <SlotCard
            key={slot.id}
            ctx={ctx}
            slot={slot}
            assignment={getAssignmentForSlot(slot.id)}
            disabled={ctx.disabled}
            onSelectAsset={() => handleSelectAssetForSlot(slot)}
            onRemoveAsset={() => handleRemoveAssetFromSlot(slot.id)}
            onEditMetadata={() => handleEditMetadata(slot)}
          />
        ))}
      </div>
    </div>
  );
}
