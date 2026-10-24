import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { useCallback, useState } from 'react';
import type { LayoutConfig, LayoutSlot, WidthOption } from '../../types';
import {
  applyColumnsChange,
  applyRowsChange,
  applySlotUpdate,
  buildOccupancy,
  computeEmptyCells,
  createGridSlot,
  createMasonrySlot,
  type GridDirection,
  type MasonryDirection,
  moveGridSlot,
  moveMasonrySlot,
} from './grid';
import LayoutPreview from './LayoutPreview';
import LayoutSettings from './LayoutSettings';
import SlotList, { type SlotMove } from './SlotList';

type Props = {
  config: LayoutConfig;
  onChange: (config: LayoutConfig) => void;
  widthOptions: WidthOption[];
  /** The errors of the field settings (ctx.errors), by key */
  errors?: Partial<Record<string, string>>;
};

const NO_ERRORS: Partial<Record<string, string>> = {};

type UseSlotManagementArgs = {
  config: LayoutConfig;
  isMasonry: boolean;
  openSlotId: string | null;
  onChange: (config: LayoutConfig) => void;
  setOpenSlotId: (id: string | null) => void;
};

/**
 * The changes of the slots, as the builder applies them: the grid size, the
 * new slots (which open), the settings of a slot, the moves and the delete
 * (which closes the slot when it is open).
 */
function useSlotManagement({
  config,
  isMasonry,
  openSlotId,
  onChange,
  setOpenSlotId,
}: UseSlotManagementArgs) {
  const handleColumnsChange = useCallback(
    (columns: number) =>
      onChange(applyColumnsChange(config, columns, isMasonry)),
    [config, isMasonry, onChange],
  );

  const handleRowsChange = useCallback(
    (rows: number) => onChange(applyRowsChange(config, rows)),
    [config, onChange],
  );

  const handleAddSlotAtPosition = useCallback(
    (row: number, col: number) => {
      const newSlot = createGridSlot(config, row, col);
      onChange({ ...config, slots: [...config.slots, newSlot] });
      setOpenSlotId(newSlot.id);
    },
    [config, onChange, setOpenSlotId],
  );

  const handleAddSlotMasonry = useCallback(() => {
    const newSlot = createMasonrySlot(config);
    onChange({ ...config, slots: [...config.slots, newSlot] });
    setOpenSlotId(newSlot.id);
  }, [config, onChange, setOpenSlotId]);

  const handleUpdateSlot = useCallback(
    (slotId: string, updates: Partial<LayoutSlot>) =>
      onChange(applySlotUpdate(config, slotId, updates)),
    [config, onChange],
  );

  const handleMoveSlot = useCallback(
    (slotId: string, move: SlotMove) => {
      const slots = isMasonry
        ? moveMasonrySlot(config, slotId, move as MasonryDirection)
        : moveGridSlot(config, slotId, move as GridDirection);
      if (slots) onChange({ ...config, slots });
    },
    [config, isMasonry, onChange],
  );

  const handleDeleteSlot = useCallback(
    (slotId: string) => {
      const newSlots = config.slots.filter((slot) => slot.id !== slotId);
      onChange({ ...config, slots: newSlots });
      if (openSlotId === slotId) {
        setOpenSlotId(null);
      }
    },
    [config, onChange, openSlotId, setOpenSlotId],
  );

  return {
    handleColumnsChange,
    handleRowsChange,
    handleAddSlotAtPosition,
    handleAddSlotMasonry,
    handleUpdateSlot,
    handleMoveSlot,
    handleDeleteSlot,
  };
}

const GRID_PREVIEW_HINT =
  'Click an empty cell to add a slot, and drag a slot to move it.';
// No cell is left, thus the grid offers no way to add a slot: say why
const FULL_GRID_PREVIEW_HINT =
  'The grid is full. Add rows or columns to add a slot, and drag a slot to move it.';
const MASONRY_PREVIEW_HINT = 'Drag a slot to change the order.';

function previewHint(config: LayoutConfig, isMasonry: boolean): string {
  if (isMasonry) return MASONRY_PREVIEW_HINT;
  const emptyCells = computeEmptyCells(config, buildOccupancy(config));
  return emptyCells.length > 0 ? GRID_PREVIEW_HINT : FULL_GRID_PREVIEW_HINT;
}

/**
 * The layout of a field in layout mode: the settings of the whole layout,
 * the preview of the grid (where a click on an empty cell adds a slot and a
 * drag moves a slot), and the list of the slots with their settings. A slot
 * opened in the preview opens in the list, one at a time.
 */
export default function LayoutBuilder({
  config,
  onChange,
  widthOptions,
  errors = NO_ERRORS,
}: Props) {
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);

  const isMasonry = config.layoutStyle === 'masonry';

  const {
    handleColumnsChange,
    handleRowsChange,
    handleAddSlotAtPosition,
    handleAddSlotMasonry,
    handleUpdateSlot,
    handleMoveSlot,
    handleDeleteSlot,
  } = useSlotManagement({
    config,
    isMasonry,
    openSlotId,
    onChange,
    setOpenSlotId,
  });

  const handleToggleSlot = useCallback((slotId: string) => {
    setOpenSlotId((current) => (current === slotId ? null : slotId));
  }, []);

  // A masonry with no slots has nothing to preview: the list below adds the
  // first one. A grid always shows its cells, where a click adds a slot.
  const showPreview = !isMasonry || config.slots.length > 0;

  return (
    <>
      <LayoutSettings
        config={config}
        widthOptions={widthOptions}
        onChange={onChange}
        onColumnsChange={handleColumnsChange}
        onRowsChange={handleRowsChange}
      />

      {showPreview && (
        <FieldWrapper label="Preview" hint={previewHint(config, isMasonry)}>
          <LayoutPreview
            config={config}
            isMasonry={isMasonry}
            widthOptions={widthOptions}
            openSlotId={openSlotId}
            onToggleSlot={handleToggleSlot}
            onAddSlotAt={handleAddSlotAtPosition}
            onChange={onChange}
          />
        </FieldWrapper>
      )}

      <SlotList
        config={config}
        isMasonry={isMasonry}
        widthOptions={widthOptions}
        errors={errors}
        openSlotId={openSlotId}
        onToggleSlot={handleToggleSlot}
        onAddSlot={handleAddSlotMasonry}
        onUpdateSlot={handleUpdateSlot}
        onMoveSlot={handleMoveSlot}
        onDeleteSlot={handleDeleteSlot}
      />
    </>
  );
}
