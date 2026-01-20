import { useCallback, useState } from 'react';
import {
  COLUMN_OPTIONS,
  ROW_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_WIDTH,
  ASPECT_RATIO_OPTIONS,
  WIDTH_OPTIONS,
} from '../../constants';
import type { LayoutConfig, LayoutSlot } from '../../types';
import SlotItem from './SlotItem';
import s from './styles.module.css';

type Props = {
  config: LayoutConfig;
  onChange: (config: LayoutConfig) => void;
};

function generateSlotId() {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

type CellPosition = { row: number; col: number };

export default function LayoutBuilder({ config, onChange }: Props) {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<CellPosition | null>(null);

  const selectedSlot = selectedSlotId
    ? config.slots.find((s) => s.id === selectedSlotId)
    : null;

  // Get slot at a specific position
  const getSlotAtPosition = useCallback(
    (row: number, col: number) =>
      config.slots.find((s) => s.row === row && s.col === col),
    [config.slots]
  );

  const handleColumnsChange = useCallback(
    (columns: number) => {
      // Filter out slots that would be outside the new grid
      const validSlots = config.slots.filter(
        (slot) => slot.col < columns && slot.row < config.rows
      );
      onChange({ ...config, columns, slots: validSlots });
    },
    [config, onChange]
  );

  const handleRowsChange = useCallback(
    (rows: number) => {
      // Filter out slots that would be outside the new grid
      const validSlots = config.slots.filter(
        (slot) => slot.row < rows && slot.col < config.columns
      );
      onChange({ ...config, rows, slots: validSlots });
    },
    [config, onChange]
  );

  const handleAddSlotAtPosition = useCallback(
    (row: number, col: number) => {
      const newSlot: LayoutSlot = {
        id: generateSlotId(),
        label: `Slot ${config.slots.length + 1}`,
        aspectRatio: DEFAULT_ASPECT_RATIO,
        width: DEFAULT_WIDTH,
        row,
        col,
        required: false,
      };
      onChange({ ...config, slots: [...config.slots, newSlot] });
      setSelectedSlotId(newSlot.id);
    },
    [config, onChange]
  );

  const handleUpdateSlot = useCallback(
    (slotId: string, updates: Partial<LayoutSlot>) => {
      const newSlots = config.slots.map((slot) =>
        slot.id === slotId ? { ...slot, ...updates } : slot
      );
      onChange({ ...config, slots: newSlots });
    },
    [config, onChange]
  );

  const handleDeleteSlot = useCallback(
    (slotId: string) => {
      const newSlots = config.slots.filter((s) => s.id !== slotId);
      onChange({ ...config, slots: newSlots });
      if (selectedSlotId === slotId) {
        setSelectedSlotId(null);
      }
    },
    [config, onChange, selectedSlotId]
  );

  // Drag handlers for slots
  const handleDragStart = useCallback(
    (slotId: string) => (e: React.DragEvent) => {
      setDraggedSlotId(slotId);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', slotId);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDraggedSlotId(null);
    setDragOverCell(null);
  }, []);

  // Drag over a slot (swap)
  const handleDragOverSlot = useCallback(
    (slotId: string, row: number, col: number) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (slotId !== draggedSlotId) {
        setDragOverCell({ row, col });
      }
    },
    [draggedSlotId]
  );

  // Drag over an empty cell
  const handleDragOverEmpty = useCallback(
    (row: number, col: number) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverCell({ row, col });
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDragOverCell(null);
  }, []);

  // Drop on a slot (swap positions)
  const handleDropOnSlot = useCallback(
    (targetSlotId: string) => (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverCell(null);

      if (!draggedSlotId || draggedSlotId === targetSlotId) {
        setDraggedSlotId(null);
        return;
      }

      const draggedSlot = config.slots.find((s) => s.id === draggedSlotId);
      const targetSlot = config.slots.find((s) => s.id === targetSlotId);

      if (!draggedSlot || !targetSlot) {
        setDraggedSlotId(null);
        return;
      }

      // Swap positions
      const newSlots = config.slots.map((slot) => {
        if (slot.id === draggedSlotId) {
          return { ...slot, row: targetSlot.row, col: targetSlot.col };
        }
        if (slot.id === targetSlotId) {
          return { ...slot, row: draggedSlot.row, col: draggedSlot.col };
        }
        return slot;
      });

      onChange({ ...config, slots: newSlots });
      setDraggedSlotId(null);
    },
    [config, onChange, draggedSlotId]
  );

  // Drop on an empty cell (move to that position)
  const handleDropOnEmpty = useCallback(
    (row: number, col: number) => (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverCell(null);

      if (!draggedSlotId) {
        setDraggedSlotId(null);
        return;
      }

      const newSlots = config.slots.map((slot) =>
        slot.id === draggedSlotId ? { ...slot, row, col } : slot
      );

      onChange({ ...config, slots: newSlots });
      setDraggedSlotId(null);
    },
    [config, onChange, draggedSlotId]
  );

  // Generate all cells for the grid
  const cells: Array<{ row: number; col: number; slot: LayoutSlot | undefined }> = [];
  for (let row = 0; row < config.rows; row++) {
    for (let col = 0; col < config.columns; col++) {
      cells.push({ row, col, slot: getSlotAtPosition(row, col) });
    }
  }

  const aspectRatioOptions = ASPECT_RATIO_OPTIONS.filter(
    (opt) => opt.value !== 'custom'
  );

  return (
    <div className={s.container}>
      <div className={s.toolbar}>
        <div className={s.gridControls}>
          <div className={s.controlGroup}>
            <span className={s.controlLabel}>Columns:</span>
            <select
              value={config.columns}
              onChange={(e) => handleColumnsChange(Number(e.target.value))}
              className={s.controlSelect}
            >
              {COLUMN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value}
                </option>
              ))}
            </select>
          </div>

          <div className={s.controlGroup}>
            <span className={s.controlLabel}>Rows:</span>
            <select
              value={config.rows}
              onChange={(e) => handleRowsChange(Number(e.target.value))}
              className={s.controlSelect}
            >
              {ROW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={s.gridInfo}>
          {config.slots.length} / {config.rows * config.columns} slots
        </div>
      </div>

      <div className={s.gridPreview}>
        <div className={s.grid} data-columns={config.columns}>
          {cells.map(({ row, col, slot }) =>
            slot ? (
              <SlotItem
                key={slot.id}
                slot={slot}
                isSelected={selectedSlotId === slot.id}
                isDragging={draggedSlotId === slot.id}
                isDragOver={
                  dragOverCell?.row === row && dragOverCell?.col === col
                }
                onSelect={() => setSelectedSlotId(slot.id)}
                onDelete={() => handleDeleteSlot(slot.id)}
                onDragStart={handleDragStart(slot.id)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOverSlot(slot.id, row, col)}
                onDragLeave={handleDragLeave}
                onDrop={handleDropOnSlot(slot.id)}
              />
            ) : (
              <EmptyCell
                key={`empty-${row}-${col}`}
                row={row}
                col={col}
                isDragOver={
                  dragOverCell?.row === row && dragOverCell?.col === col
                }
                onAdd={() => handleAddSlotAtPosition(row, col)}
                onDragOver={handleDragOverEmpty(row, col)}
                onDragLeave={handleDragLeave}
                onDrop={handleDropOnEmpty(row, col)}
              />
            )
          )}
        </div>
      </div>

      {selectedSlot && (
        <div className={s.editPanel}>
          <div className={s.editPanelHeader}>
            <span className={s.editPanelTitle}>Edit Slot</span>
            <button
              type="button"
              className={s.closeButton}
              onClick={() => setSelectedSlotId(null)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className={s.editPanelForm}>
            <div className={s.formField}>
              <label className={s.formLabel}>Label</label>
              <input
                type="text"
                className={s.formInput}
                value={selectedSlot.label}
                placeholder="Enter slot label..."
                onChange={(e) =>
                  handleUpdateSlot(selectedSlot.id, { label: e.target.value })
                }
              />
            </div>

            <div className={s.formRow}>
              <div className={s.formField}>
                <label className={s.formLabel}>Aspect Ratio</label>
                <select
                  className={s.formSelect}
                  value={selectedSlot.aspectRatio}
                  onChange={(e) =>
                    handleUpdateSlot(selectedSlot.id, {
                      aspectRatio: e.target.value,
                    })
                  }
                >
                  {aspectRatioOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={s.formField}>
                <label className={s.formLabel}>Width</label>
                <select
                  className={s.formSelect}
                  value={selectedSlot.width}
                  onChange={(e) =>
                    handleUpdateSlot(selectedSlot.id, {
                      width: Number(e.target.value),
                    })
                  }
                >
                  {WIDTH_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className={s.formCheckbox}>
              <input
                type="checkbox"
                checked={selectedSlot.required}
                onChange={(e) =>
                  handleUpdateSlot(selectedSlot.id, {
                    required: e.target.checked,
                  })
                }
              />
              <span>Required field</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// Empty cell component
type EmptyCellProps = {
  row: number;
  col: number;
  isDragOver: boolean;
  onAdd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};

function EmptyCell({
  isDragOver,
  onAdd,
  onDragOver,
  onDragLeave,
  onDrop,
}: EmptyCellProps) {
  const cellClasses = [s.emptyCell, isDragOver && s.isDragOver]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cellClasses}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button type="button" className={s.addCellButton} onClick={onAdd}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
