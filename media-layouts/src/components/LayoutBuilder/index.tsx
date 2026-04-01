import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ASPECT_RATIO_OPTIONS,
  COLUMN_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_WIDTH,
  ROW_OPTIONS,
} from '../../constants';
import type { LayoutConfig, LayoutSlot, WidthOption } from '../../types';
import {
  formatDimensions,
  getEffectiveRatio,
  validateCustomAspectRatio,
} from '../../utils/aspectRatio';
import {
  MAX_WIDTH,
  MIN_WIDTH,
  parseCustomWidth,
  validateCustomWidth,
} from '../../utils/width';
import SlotItem from './SlotItem';
import s from './styles.module.css';

type Props = {
  config: LayoutConfig;
  onChange: (config: LayoutConfig) => void;
  widthOptions: WidthOption[];
};

function generateSlotId() {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

type SpanCandidate = {
  rowSpan: number;
  colSpan: number;
  error: number;
  area: number;
};

function isBetterSpanCandidate(
  candidate: SpanCandidate,
  best: SpanCandidate | null,
): boolean {
  if (!best) return true;
  if (candidate.error < best.error - 0.001) return true;
  return (
    Math.abs(candidate.error - best.error) <= 0.001 &&
    candidate.area < best.area
  );
}

function findBestSpanInGrid(
  grid: Array<Array<string | null>>,
  canPlaceAt: (
    grid: Array<Array<string | null>>,
    row: number,
    col: number,
    rowSpan: number,
    colSpan: number,
  ) => boolean,
  slotRow: number,
  slotCol: number,
  maxRowSpan: number,
  maxColSpan: number,
  targetRatio: number,
): SpanCandidate | null {
  let best: SpanCandidate | null = null;
  for (let rowSpan = 1; rowSpan <= maxRowSpan; rowSpan++) {
    for (let colSpan = 1; colSpan <= maxColSpan; colSpan++) {
      if (!canPlaceAt(grid, slotRow, slotCol, rowSpan, colSpan)) continue;
      const candidateRatio = colSpan / rowSpan;
      const error = Math.abs(candidateRatio - targetRatio);
      const area = rowSpan * colSpan;
      const candidate: SpanCandidate = { rowSpan, colSpan, error, area };
      if (isBetterSpanCandidate(candidate, best)) {
        best = candidate;
      }
    }
  }
  return best;
}

function markSlotInGrid(
  grid: Array<Array<string | null>>,
  slotId: string,
  startRow: number,
  startCol: number,
  rowSpan: number,
  colSpan: number,
  maxRows: number,
  maxCols: number,
) {
  for (let row = startRow; row < startRow + rowSpan; row++) {
    for (let col = startCol; col < startCol + colSpan; col++) {
      if (row >= 0 && row < maxRows && col >= 0 && col < maxCols) {
        grid[row][col] = slotId;
      }
    }
  }
}

type CellPosition = { row: number; col: number };

function computeGridSpanOptions(
  grid: Array<Array<string | null>>,
  canPlaceAt: (
    g: Array<Array<string | null>>,
    row: number,
    col: number,
    rowSpan: number,
    colSpan: number,
  ) => boolean,
  slot: LayoutSlot,
  rowSpan: number,
  colSpan: number,
  maxRowSpan: number,
  maxColSpan: number,
): { rowOptions: number[]; colOptions: number[] } {
  const rowOptions: number[] = [];
  for (let span = 1; span <= maxRowSpan; span++) {
    if (canPlaceAt(grid, slot.row, slot.col, span, colSpan)) {
      rowOptions.push(span);
    }
  }
  const colOptions: number[] = [];
  for (let span = 1; span <= maxColSpan; span++) {
    if (canPlaceAt(grid, slot.row, slot.col, rowSpan, span)) {
      colOptions.push(span);
    }
  }
  if (!rowOptions.includes(rowSpan)) {
    rowOptions.unshift(rowSpan);
  }
  if (!colOptions.includes(colSpan)) {
    colOptions.unshift(colSpan);
  }
  return { rowOptions, colOptions };
}

function reorderMasonrySlots(
  slots: LayoutSlot[],
  draggedId: string,
  targetId: string,
): LayoutSlot[] {
  const newSlots = [...slots];
  const draggedIndex = newSlots.findIndex((slot) => slot.id === draggedId);
  const targetIndex = newSlots.findIndex((slot) => slot.id === targetId);
  if (draggedIndex >= 0 && targetIndex >= 0 && draggedIndex !== targetIndex) {
    const [moved] = newSlots.splice(draggedIndex, 1);
    const insertIndex =
      draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    newSlots.splice(insertIndex, 0, moved);
  }
  return newSlots;
}

function swapGridSlotPositions(
  slots: LayoutSlot[],
  draggedId: string,
  targetId: string,
  draggedSlot: LayoutSlot,
  targetSlot: LayoutSlot,
): LayoutSlot[] {
  return slots.map((slot) => {
    if (slot.id === draggedId) {
      return { ...slot, row: targetSlot.row, col: targetSlot.col };
    }
    if (slot.id === targetId) {
      return { ...slot, row: draggedSlot.row, col: draggedSlot.col };
    }
    return slot;
  });
}

const MASONRY_ROW_HEIGHT = 8;

type LayoutControlsProps = {
  config: LayoutConfig;
  layoutAspectRatioOptions: { value: string; label: string }[];
  layoutAspectRatioSelection: string;
  layoutCustomAspectRatioValue: string;
  layoutCustomAspectRatioError: string | undefined;
  layoutWidthOptions: { value: string | number; label: string }[];
  layoutWidthSelection: string;
  layoutCustomWidthActive: boolean;
  layoutCustomWidthInput: string;
  layoutCustomWidthError: string | undefined;
  layoutDimensions: string | null;
  onChange: (config: LayoutConfig) => void;
  onLayoutAspectRatioChange: (value: string) => void;
  onLayoutWidthChange: (value: string) => void;
  onLayoutCustomWidthInputChange: (value: string) => void;
};

function LayoutControls({
  config,
  layoutAspectRatioOptions,
  layoutAspectRatioSelection,
  layoutCustomAspectRatioValue,
  layoutCustomAspectRatioError,
  layoutWidthOptions,
  layoutWidthSelection,
  layoutCustomWidthActive,
  layoutCustomWidthInput,
  layoutCustomWidthError,
  layoutDimensions,
  onChange,
  onLayoutAspectRatioChange,
  onLayoutWidthChange,
  onLayoutCustomWidthInputChange,
}: LayoutControlsProps) {
  return (
    <div className={s.layoutControls}>
      <div className={s.controlGroup}>
        <span className={s.controlLabel}>Layout AR:</span>
        <select
          value={layoutAspectRatioSelection}
          onChange={(e) => onLayoutAspectRatioChange(e.target.value)}
          className={s.controlSelect}
        >
          {layoutAspectRatioOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {layoutAspectRatioSelection === 'custom' && (
        <div className={s.controlGroupColumn}>
          <div className={s.controlGroup}>
            <span className={s.controlLabel}>Custom AR:</span>
            <input
              type="text"
              className={
                layoutCustomAspectRatioError
                  ? `${s.controlInput} ${s.inputError}`
                  : s.controlInput
              }
              value={layoutCustomAspectRatioValue}
              placeholder="2.35:1"
              onChange={(e) =>
                onChange({
                  ...config,
                  layoutAspectRatio: 'custom',
                  layoutCustomAspectRatio: e.target.value,
                })
              }
            />
          </div>
          {layoutCustomAspectRatioError && (
            <span className={s.errorText}>{layoutCustomAspectRatioError}</span>
          )}
        </div>
      )}

      <div className={s.controlGroup}>
        <span className={s.controlLabel}>Layout width:</span>
        <select
          value={layoutWidthSelection}
          onChange={(e) => onLayoutWidthChange(e.target.value)}
          className={s.controlSelect}
        >
          <option value="auto">Auto</option>
          {layoutWidthOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {layoutCustomWidthActive && (
        <div className={s.controlGroupColumn}>
          <div className={s.controlGroup}>
            <span className={s.controlLabel}>Custom width:</span>
            <input
              type="number"
              min={MIN_WIDTH}
              max={MAX_WIDTH}
              className={
                layoutCustomWidthError
                  ? `${s.controlInput} ${s.inputError}`
                  : s.controlInput
              }
              value={layoutCustomWidthInput}
              placeholder={String(DEFAULT_WIDTH)}
              onChange={(e) => onLayoutCustomWidthInputChange(e.target.value)}
            />
          </div>
          {layoutCustomWidthError && (
            <span className={s.errorText}>{layoutCustomWidthError}</span>
          )}
        </div>
      )}

      {layoutDimensions && (
        <div className={s.layoutMeta}>Layout size: {layoutDimensions}</div>
      )}
    </div>
  );
}

function buildGridContainerStyle(
  config: LayoutConfig,
  isMasonry: boolean,
): React.CSSProperties {
  const gridTemplateColumns = `repeat(${config.columns}, minmax(0, 1fr))`;
  if (isMasonry) {
    return { gridTemplateColumns, gridAutoRows: `${MASONRY_ROW_HEIGHT}px` };
  }
  return {
    gridTemplateColumns,
    gridTemplateRows: `repeat(${config.rows}, minmax(0, 1fr))`,
  };
}

function buildSlotCountLabel(config: LayoutConfig, isMasonry: boolean): string {
  if (isMasonry) return `${config.slots.length} slots`;
  return `${config.slots.length} / ${config.rows * config.columns} slots`;
}

function buildLayoutDimensions(config: LayoutConfig): string | null {
  if (!config.layoutAspectRatio || !config.layoutWidth) return null;
  const layoutRatio = getEffectiveRatio(
    config.layoutAspectRatio,
    config.layoutCustomAspectRatio,
  );
  if (!layoutRatio) return null;
  return formatDimensions(config.layoutWidth, layoutRatio);
}

function deriveSlotGridStyle(
  slot: LayoutSlot,
  isMasonry: boolean,
  colSpan: number,
  rowSpan: number,
  masonryColSpan: number,
  masonryRowSpan: number,
): React.CSSProperties {
  if (isMasonry) {
    return {
      gridColumn: `span ${masonryColSpan}`,
      gridRow: `span ${masonryRowSpan}`,
    };
  }
  return {
    gridColumn: `${slot.col + 1} / span ${colSpan}`,
    gridRow: `${slot.row + 1} / span ${rowSpan}`,
  };
}

function deriveSlotIsDragOver(
  slot: LayoutSlot,
  isMasonry: boolean,
  dragOverSlotId: string | null,
  dragOverCell: CellPosition | null,
): boolean {
  if (isMasonry) return dragOverSlotId === slot.id;
  return dragOverCell?.row === slot.row && dragOverCell?.col === slot.col;
}

function applyLayoutStyleChange(
  config: LayoutConfig,
  newLayoutStyle: 'grid' | 'masonry',
  onChange: (config: LayoutConfig) => void,
) {
  if (newLayoutStyle !== 'grid') {
    onChange({ ...config, layoutStyle: newLayoutStyle });
    return;
  }
  const { columns, rows } = config;
  const maxSlots = columns * rows;
  const reordered = config.slots.slice(0, maxSlots).map((slot, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return { ...slot, row, col, rowSpan: 1, colSpan: 1, autoSpan: false };
  });
  onChange({ ...config, layoutStyle: newLayoutStyle, slots: reordered });
}

function applyLayoutAspectRatioChange(
  config: LayoutConfig,
  value: string,
  layoutCustomAspectRatioValue: string,
  onChange: (config: LayoutConfig) => void,
) {
  if (value === 'auto') {
    onChange({
      ...config,
      layoutAspectRatio: undefined,
      layoutCustomAspectRatio: undefined,
    });
    return;
  }
  if (value === 'custom') {
    onChange({
      ...config,
      layoutAspectRatio: 'custom',
      layoutCustomAspectRatio: layoutCustomAspectRatioValue || '',
    });
    return;
  }
  onChange({
    ...config,
    layoutAspectRatio: value,
    layoutCustomAspectRatio: undefined,
  });
}

function deriveLayoutAspectRatioSelection(
  layoutAspectRatio: string | undefined,
  layoutPresetAspectRatioValues: string[],
): string {
  if (!layoutAspectRatio) return 'auto';
  const isCustom =
    layoutAspectRatio === 'custom' ||
    !layoutPresetAspectRatioValues.includes(layoutAspectRatio);
  return isCustom ? 'custom' : layoutAspectRatio;
}

function deriveLayoutCustomAspectRatioValue(
  layoutAspectRatio: string | undefined,
  layoutCustomAspectRatio: string | undefined,
  layoutPresetAspectRatioValues: string[],
): string {
  if (!layoutAspectRatio) return '';
  if (layoutAspectRatio === 'custom') return layoutCustomAspectRatio ?? '';
  if (!layoutPresetAspectRatioValues.includes(layoutAspectRatio)) {
    return layoutAspectRatio;
  }
  return '';
}

type UseLayoutWidthControlsArgs = {
  config: LayoutConfig;
  layoutPresetWidthValues: (string | number)[];
  onChange: (config: LayoutConfig) => void;
};

function useLayoutWidthControls({
  config,
  layoutPresetWidthValues,
  onChange,
}: UseLayoutWidthControlsArgs) {
  const layoutWidthIsCustomValue =
    typeof config.layoutWidth === 'number' &&
    !layoutPresetWidthValues.includes(config.layoutWidth);

  const [layoutCustomWidthActive, setLayoutCustomWidthActive] = useState(
    layoutWidthIsCustomValue,
  );
  const [layoutCustomWidthInput, setLayoutCustomWidthInput] = useState(
    layoutWidthIsCustomValue && config.layoutWidth
      ? String(config.layoutWidth)
      : '',
  );

  useEffect(() => {
    if (layoutWidthIsCustomValue) {
      setLayoutCustomWidthActive(true);
      setLayoutCustomWidthInput(String(config.layoutWidth));
      return;
    }
    if (config.layoutWidth === undefined) {
      setLayoutCustomWidthActive(false);
      setLayoutCustomWidthInput('');
    }
  }, [config.layoutWidth, layoutWidthIsCustomValue]);

  const layoutCustomWidthError = layoutCustomWidthActive
    ? validateCustomWidth(layoutCustomWidthInput)
    : undefined;

  const layoutWidthSelection =
    config.layoutWidth === undefined
      ? 'auto'
      : layoutCustomWidthActive
        ? 'custom'
        : String(config.layoutWidth);

  const handleLayoutWidthChange = useCallback(
    (value: string) => {
      if (value === 'auto') {
        setLayoutCustomWidthActive(false);
        setLayoutCustomWidthInput('');
        onChange({ ...config, layoutWidth: undefined });
        return;
      }
      if (value === 'custom') {
        const fallback =
          typeof config.layoutWidth === 'number'
            ? config.layoutWidth
            : DEFAULT_WIDTH;
        setLayoutCustomWidthActive(true);
        setLayoutCustomWidthInput(String(fallback));
        onChange({ ...config, layoutWidth: fallback });
        return;
      }
      setLayoutCustomWidthActive(false);
      setLayoutCustomWidthInput('');
      onChange({ ...config, layoutWidth: Number(value) });
    },
    [config, onChange],
  );

  const handleLayoutCustomWidthInputChange = useCallback(
    (value: string) => {
      setLayoutCustomWidthInput(value);
      const parsed = parseCustomWidth(value);
      if (parsed !== null && !validateCustomWidth(value)) {
        onChange({ ...config, layoutWidth: parsed });
      }
    },
    [config, onChange],
  );

  return {
    layoutCustomWidthActive,
    layoutCustomWidthInput,
    layoutCustomWidthError,
    layoutWidthSelection,
    handleLayoutWidthChange,
    handleLayoutCustomWidthInputChange,
  };
}

type UseGridOccupancyArgs = {
  config: LayoutConfig;
};

function useGridOccupancy({ config }: UseGridOccupancyArgs) {
  const clampSlotToGrid = useCallback(
    (slot: LayoutSlot, columns: number, rows: number): LayoutSlot => {
      const row = slot.row;
      const col = slot.col;
      const rowSpan =
        typeof slot.rowSpan === 'number' && slot.rowSpan > 0 ? slot.rowSpan : 1;
      const colSpan =
        typeof slot.colSpan === 'number' && slot.colSpan > 0 ? slot.colSpan : 1;
      return {
        ...slot,
        rowSpan: Math.min(rowSpan, Math.max(1, rows - row)),
        colSpan: Math.min(colSpan, Math.max(1, columns - col)),
      };
    },
    [],
  );

  const getSlotSpan = useCallback(
    (slot: LayoutSlot) => {
      const rowSpan =
        typeof slot.rowSpan === 'number' && slot.rowSpan > 0 ? slot.rowSpan : 1;
      const colSpan =
        typeof slot.colSpan === 'number' && slot.colSpan > 0 ? slot.colSpan : 1;
      return {
        rowSpan: Math.min(rowSpan, Math.max(1, config.rows - slot.row)),
        colSpan: Math.min(colSpan, Math.max(1, config.columns - slot.col)),
      };
    },
    [config.columns, config.rows],
  );

  const buildOccupancy = useCallback(
    (ignoreSlotIds: string[] = []) => {
      const grid: Array<Array<string | null>> = Array.from(
        { length: config.rows },
        () => Array.from({ length: config.columns }, () => null),
      );

      for (const slot of config.slots) {
        if (ignoreSlotIds.includes(slot.id)) continue;
        const { rowSpan, colSpan } = getSlotSpan(slot);
        markSlotInGrid(
          grid,
          slot.id,
          slot.row,
          slot.col,
          rowSpan,
          colSpan,
          config.rows,
          config.columns,
        );
      }

      return grid;
    },
    [config.columns, config.rows, config.slots, getSlotSpan],
  );

  const canPlaceAt = useCallback(
    (
      grid: Array<Array<string | null>>,
      row: number,
      col: number,
      rowSpan: number,
      colSpan: number,
    ) => {
      if (row < 0 || col < 0) return false;
      if (row + rowSpan > config.rows || col + colSpan > config.columns) {
        return false;
      }
      for (let r = row; r < row + rowSpan; r++) {
        for (let c = col; c < col + colSpan; c++) {
          if (grid[r][c]) return false;
        }
      }
      return true;
    },
    [config.columns, config.rows],
  );

  const findBestSpanForSlot = useCallback(
    (slot: LayoutSlot) => {
      const ratio =
        getEffectiveRatio(slot.aspectRatio, slot.customAspectRatio) ?? null;
      if (!ratio || ratio <= 0) return null;

      const grid = buildOccupancy([slot.id]);
      const maxRowSpan = config.rows - slot.row;
      const maxColSpan = config.columns - slot.col;
      const currentSpan = getSlotSpan(slot);

      const best = findBestSpanInGrid(
        grid,
        canPlaceAt,
        slot.row,
        slot.col,
        maxRowSpan,
        maxColSpan,
        ratio,
      );

      if (!best) return null;
      if (
        best.rowSpan === currentSpan.rowSpan &&
        best.colSpan === currentSpan.colSpan
      ) {
        return null;
      }

      return { rowSpan: best.rowSpan, colSpan: best.colSpan };
    },
    [buildOccupancy, canPlaceAt, config.columns, config.rows, getSlotSpan],
  );

  return {
    clampSlotToGrid,
    getSlotSpan,
    buildOccupancy,
    canPlaceAt,
    findBestSpanForSlot,
  };
}

type UseDragHandlersArgs = {
  config: LayoutConfig;
  isMasonry: boolean;
  draggedSlotIdRef: React.RefObject<string | null>;
  getSlotSpan: (slot: LayoutSlot) => { rowSpan: number; colSpan: number };
  buildOccupancy: (ignoreSlotIds?: string[]) => Array<Array<string | null>>;
  canPlaceAt: (
    grid: Array<Array<string | null>>,
    row: number,
    col: number,
    rowSpan: number,
    colSpan: number,
  ) => boolean;
  onChange: (config: LayoutConfig) => void;
  setDraggedSlotId: (id: string | null) => void;
  setDragOverCell: (cell: CellPosition | null) => void;
  setDragOverSlotId: (id: string | null) => void;
};

function useDragHandlers({
  config,
  isMasonry,
  draggedSlotIdRef,
  getSlotSpan,
  buildOccupancy,
  canPlaceAt,
  onChange,
  setDraggedSlotId,
  setDragOverCell,
  setDragOverSlotId,
}: UseDragHandlersArgs) {
  const handleDragStart = useCallback(
    (slotId: string) => (e: React.DragEvent) => {
      setDraggedSlotId(slotId);
      draggedSlotIdRef.current = slotId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', slotId);
    },
    [draggedSlotIdRef, setDraggedSlotId],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedSlotId(null);
    draggedSlotIdRef.current = null;
    setDragOverCell(null);
    setDragOverSlotId(null);
  }, [draggedSlotIdRef, setDraggedSlotId, setDragOverCell, setDragOverSlotId]);

  const handleDragOverSlot = useCallback(
    (slotId: string, row: number, col: number) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const activeDragId = draggedSlotIdRef.current;
      if (!activeDragId || slotId === activeDragId) return;

      if (isMasonry) {
        setDragOverSlotId(slotId);
        return;
      }
      setDragOverCell({ row, col });
    },
    [draggedSlotIdRef, isMasonry, setDragOverCell, setDragOverSlotId],
  );

  const handleDragOverEmpty = useCallback(
    (row: number, col: number) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (isMasonry) return;
      const activeDragId = draggedSlotIdRef.current;
      if (!activeDragId) return;
      const draggedSlot = config.slots.find((slot) => slot.id === activeDragId);
      if (!draggedSlot) return;
      const { rowSpan, colSpan } = getSlotSpan(draggedSlot);
      const grid = buildOccupancy([draggedSlot.id]);
      if (canPlaceAt(grid, row, col, rowSpan, colSpan)) {
        setDragOverCell({ row, col });
      }
    },
    [
      buildOccupancy,
      canPlaceAt,
      config.slots,
      draggedSlotIdRef,
      getSlotSpan,
      isMasonry,
      setDragOverCell,
    ],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverCell(null);
    setDragOverSlotId(null);
  }, [setDragOverCell, setDragOverSlotId]);

  const handleDropOnSlot = useCallback(
    (targetSlotId: string) => (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverCell(null);

      const activeDragId = draggedSlotIdRef.current;
      if (!activeDragId || activeDragId === targetSlotId) {
        setDraggedSlotId(null);
        draggedSlotIdRef.current = null;
        return;
      }

      const draggedSlot = config.slots.find((s) => s.id === activeDragId);
      const targetSlot = config.slots.find((s) => s.id === targetSlotId);

      if (!draggedSlot || !targetSlot) {
        setDraggedSlotId(null);
        draggedSlotIdRef.current = null;
        return;
      }

      if (isMasonry) {
        const newSlots = reorderMasonrySlots(
          config.slots,
          activeDragId,
          targetSlotId,
        );
        onChange({ ...config, slots: newSlots });
        setDraggedSlotId(null);
        draggedSlotIdRef.current = null;
        setDragOverSlotId(null);
        return;
      }

      const grid = buildOccupancy([draggedSlot.id, targetSlot.id]);
      const draggedSpan = getSlotSpan(draggedSlot);
      const targetSpan = getSlotSpan(targetSlot);
      const draggedFits = canPlaceAt(
        grid,
        targetSlot.row,
        targetSlot.col,
        draggedSpan.rowSpan,
        draggedSpan.colSpan,
      );
      const targetFits = canPlaceAt(
        grid,
        draggedSlot.row,
        draggedSlot.col,
        targetSpan.rowSpan,
        targetSpan.colSpan,
      );

      if (draggedFits && targetFits) {
        const newSlots = swapGridSlotPositions(
          config.slots,
          activeDragId,
          targetSlotId,
          draggedSlot,
          targetSlot,
        );
        onChange({ ...config, slots: newSlots });
      }
      setDraggedSlotId(null);
      draggedSlotIdRef.current = null;
    },
    [
      buildOccupancy,
      canPlaceAt,
      config,
      draggedSlotIdRef,
      getSlotSpan,
      isMasonry,
      onChange,
      setDragOverCell,
      setDraggedSlotId,
      setDragOverSlotId,
    ],
  );

  const handleDropOnEmpty = useCallback(
    (row: number, col: number) => (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverCell(null);

      const activeDragId = draggedSlotIdRef.current;
      if (!activeDragId) {
        setDraggedSlotId(null);
        draggedSlotIdRef.current = null;
        return;
      }

      if (isMasonry) {
        setDraggedSlotId(null);
        draggedSlotIdRef.current = null;
        return;
      }

      const draggedSlot = config.slots.find((slot) => slot.id === activeDragId);
      if (!draggedSlot) {
        setDraggedSlotId(null);
        draggedSlotIdRef.current = null;
        return;
      }
      const { rowSpan, colSpan } = getSlotSpan(draggedSlot);
      const grid = buildOccupancy([draggedSlot.id]);
      if (!canPlaceAt(grid, row, col, rowSpan, colSpan)) {
        setDraggedSlotId(null);
        draggedSlotIdRef.current = null;
        return;
      }

      const newSlots = config.slots.map((slot) =>
        slot.id === activeDragId ? { ...slot, row, col } : slot,
      );

      onChange({ ...config, slots: newSlots });
      setDraggedSlotId(null);
      draggedSlotIdRef.current = null;
    },
    [
      buildOccupancy,
      canPlaceAt,
      config,
      draggedSlotIdRef,
      getSlotSpan,
      isMasonry,
      onChange,
      setDragOverCell,
      setDraggedSlotId,
    ],
  );

  return {
    handleDragStart,
    handleDragEnd,
    handleDragOverSlot,
    handleDragOverEmpty,
    handleDragLeave,
    handleDropOnSlot,
    handleDropOnEmpty,
  };
}

function computeEmptyCells(
  config: LayoutConfig,
  occupancy: Array<Array<string | null>>,
): CellPosition[] {
  const cells: CellPosition[] = [];
  for (let row = 0; row < config.rows; row++) {
    for (let col = 0; col < config.columns; col++) {
      if (!occupancy[row][col]) {
        cells.push({ row, col });
      }
    }
  }
  return cells;
}

function computeSpanOptions(
  selectedSlot: LayoutSlot | null | undefined,
  isMasonry: boolean,
  config: LayoutConfig,
  buildOccupancy: (ignoreSlotIds?: string[]) => Array<Array<string | null>>,
  getSlotSpan: (slot: LayoutSlot) => { rowSpan: number; colSpan: number },
  canPlaceAt: (
    grid: Array<Array<string | null>>,
    row: number,
    col: number,
    rowSpan: number,
    colSpan: number,
  ) => boolean,
) {
  if (!selectedSlot) {
    return { rowOptions: [], colOptions: [], rowSpan: 1, colSpan: 1 };
  }

  if (isMasonry) {
    const colSpan =
      typeof selectedSlot.colSpan === 'number' && selectedSlot.colSpan > 0
        ? Math.min(selectedSlot.colSpan, config.columns)
        : 1;
    const colOptions = Array.from(
      { length: config.columns },
      (_, idx) => idx + 1,
    );
    return { rowOptions: [1], colOptions, rowSpan: 1, colSpan };
  }

  const grid = buildOccupancy([selectedSlot.id]);
  const { rowSpan, colSpan } = getSlotSpan(selectedSlot);
  const maxRowSpan = config.rows - selectedSlot.row;
  const maxColSpan = config.columns - selectedSlot.col;

  const { rowOptions, colOptions } = computeGridSpanOptions(
    grid,
    canPlaceAt,
    selectedSlot,
    rowSpan,
    colSpan,
    maxRowSpan,
    maxColSpan,
  );

  return { rowOptions, colOptions, rowSpan, colSpan };
}

type UseMasonryGridMetricsArgs = {
  config: LayoutConfig;
  gridRef: React.RefObject<HTMLDivElement | null>;
};

function useMasonryGridMetrics({ config, gridRef }: UseMasonryGridMetricsArgs) {
  const [gridMetrics, setGridMetrics] = useState({ columnWidth: 0, gap: 0 });

  useLayoutEffect(() => {
    if (!gridRef.current) return;
    const element = gridRef.current;

    const computeMetrics = () => {
      const style = getComputedStyle(element);
      const gap = Number.parseFloat(style.columnGap || style.gap || '0') || 0;
      const width = element.clientWidth;
      const columnWidth =
        config.columns > 0
          ? (width - gap * (config.columns - 1)) / config.columns
          : 0;
      setGridMetrics({ columnWidth, gap });
    };

    computeMetrics();
    const observer = new ResizeObserver(() => computeMetrics());
    observer.observe(element);
    return () => observer.disconnect();
  }, [config.columns, gridRef]);

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
        Math.ceil((height + gap) / (MASONRY_ROW_HEIGHT + gap)),
      );
    },
    [gridMetrics.columnWidth, gridMetrics.gap],
  );

  return { getMasonryRowSpan };
}

type UseSlotManagementArgs = {
  config: LayoutConfig;
  isMasonry: boolean;
  selectedSlotId: string | null;
  clampSlotToGrid: (
    slot: LayoutSlot,
    columns: number,
    rows: number,
  ) => LayoutSlot;
  findBestSpanForSlot: (
    slot: LayoutSlot,
  ) => { rowSpan: number; colSpan: number } | null;
  onChange: (config: LayoutConfig) => void;
  setSelectedSlotId: (id: string | null) => void;
};

function useSlotManagement({
  config,
  isMasonry,
  selectedSlotId,
  clampSlotToGrid,
  findBestSpanForSlot,
  onChange,
  setSelectedSlotId,
}: UseSlotManagementArgs) {
  const handleColumnsChange = useCallback(
    (columns: number) => {
      const validSlots = isMasonry
        ? config.slots
        : config.slots.filter(
            (slot) => slot.col < columns && slot.row < config.rows,
          );
      const normalizedSlots = validSlots.map((slot) => {
        if (isMasonry) {
          const colSpan =
            typeof slot.colSpan === 'number' && slot.colSpan > 0
              ? Math.min(slot.colSpan, columns)
              : 1;
          return { ...slot, colSpan };
        }
        return clampSlotToGrid(slot, columns, config.rows);
      });
      onChange({ ...config, columns, slots: normalizedSlots });
    },
    [clampSlotToGrid, config, isMasonry, onChange],
  );

  const handleRowsChange = useCallback(
    (rows: number) => {
      const validSlots = config.slots.filter(
        (slot) => slot.row < rows && slot.col < config.columns,
      );
      const normalizedSlots = validSlots.map((slot) =>
        clampSlotToGrid(slot, config.columns, rows),
      );
      onChange({ ...config, rows, slots: normalizedSlots });
    },
    [clampSlotToGrid, config, onChange],
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
        rowSpan: 1,
        colSpan: 1,
        autoSpan: false,
        required: false,
      };
      onChange({ ...config, slots: [...config.slots, newSlot] });
      setSelectedSlotId(newSlot.id);
    },
    [config, onChange, setSelectedSlotId],
  );

  const handleUpdateSlot = useCallback(
    (slotId: string, updates: Partial<LayoutSlot>) => {
      const manualSpanChange =
        Object.hasOwn(updates, 'rowSpan') || Object.hasOwn(updates, 'colSpan');

      const newSlots = config.slots.map((slot) => {
        if (slot.id !== slotId) return slot;
        const resolvedAutoSpan = updates.autoSpan ?? slot.autoSpan ?? false;
        const shouldDisableAutoSpan =
          manualSpanChange && updates.autoSpan === undefined;
        const nextSlot: LayoutSlot = {
          ...slot,
          ...updates,
          autoSpan: shouldDisableAutoSpan ? false : resolvedAutoSpan,
        };

        if (nextSlot.autoSpan) {
          const autoSpan = findBestSpanForSlot(nextSlot);
          if (autoSpan) {
            nextSlot.rowSpan = autoSpan.rowSpan;
            nextSlot.colSpan = autoSpan.colSpan;
          }
        }

        return nextSlot;
      });
      onChange({ ...config, slots: newSlots });
    },
    [config, findBestSpanForSlot, onChange],
  );

  const handleDeleteSlot = useCallback(
    (slotId: string) => {
      const newSlots = config.slots.filter((s) => s.id !== slotId);
      onChange({ ...config, slots: newSlots });
      if (selectedSlotId === slotId) {
        setSelectedSlotId(null);
      }
    },
    [config, onChange, selectedSlotId, setSelectedSlotId],
  );

  const handleAddSlotMasonry = useCallback(() => {
    const newSlot: LayoutSlot = {
      id: generateSlotId(),
      label: `Slot ${config.slots.length + 1}`,
      aspectRatio: DEFAULT_ASPECT_RATIO,
      width: DEFAULT_WIDTH,
      row: 0,
      col: 0,
      rowSpan: 1,
      colSpan: 1,
      autoSpan: true,
      required: false,
    };
    onChange({ ...config, slots: [...config.slots, newSlot] });
    setSelectedSlotId(newSlot.id);
  }, [config, onChange, setSelectedSlotId]);

  return {
    handleColumnsChange,
    handleRowsChange,
    handleAddSlotAtPosition,
    handleUpdateSlot,
    handleDeleteSlot,
    handleAddSlotMasonry,
  };
}

type UseSlotWidthControlsArgs = {
  selectedSlot: LayoutSlot | null | undefined;
  presetWidthValues: Set<string | number>;
  handleUpdateSlot: (slotId: string, updates: Partial<LayoutSlot>) => void;
};

function useSlotWidthControls({
  selectedSlot,
  presetWidthValues,
  handleUpdateSlot,
}: UseSlotWidthControlsArgs) {
  const slotWidthIsCustomValue =
    !!selectedSlot &&
    typeof selectedSlot.width === 'number' &&
    !presetWidthValues.has(selectedSlot.width);

  const [slotCustomWidthActive, setSlotCustomWidthActive] = useState(
    slotWidthIsCustomValue,
  );
  const [slotCustomWidthInput, setSlotCustomWidthInput] = useState(
    slotWidthIsCustomValue ? String(selectedSlot?.width ?? '') : '',
  );

  const previousSelectedSlotId = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedSlot) {
      previousSelectedSlotId.current = null;
      setSlotCustomWidthActive(false);
      setSlotCustomWidthInput('');
      return;
    }

    const slotChanged = previousSelectedSlotId.current !== selectedSlot.id;
    previousSelectedSlotId.current = selectedSlot.id;
    const widthIsCustom =
      typeof selectedSlot.width === 'number' &&
      !presetWidthValues.has(selectedSlot.width);

    if (widthIsCustom) {
      setSlotCustomWidthActive(true);
      setSlotCustomWidthInput(String(selectedSlot.width));
      return;
    }

    if (slotChanged || selectedSlot.width === 'original') {
      setSlotCustomWidthActive(false);
      setSlotCustomWidthInput('');
    }
  }, [presetWidthValues, selectedSlot]);

  const slotCustomWidthError = slotCustomWidthActive
    ? validateCustomWidth(slotCustomWidthInput)
    : undefined;

  const handleSlotWidthSelectChange = useCallback(
    (slotId: string, value: string, currentWidth: LayoutSlot['width']) => {
      if (value === 'custom') {
        const fallback =
          typeof currentWidth === 'number' ? currentWidth : DEFAULT_WIDTH;
        setSlotCustomWidthActive(true);
        setSlotCustomWidthInput(String(fallback));
        handleUpdateSlot(slotId, { width: fallback });
        return;
      }
      setSlotCustomWidthActive(false);
      setSlotCustomWidthInput('');
      handleUpdateSlot(slotId, {
        width: value === 'original' ? 'original' : Number(value),
      });
    },
    [handleUpdateSlot],
  );

  const handleSlotCustomWidthInputChange = useCallback(
    (slotId: string, value: string) => {
      setSlotCustomWidthInput(value);
      const parsed = parseCustomWidth(value);
      if (parsed !== null && !validateCustomWidth(value)) {
        handleUpdateSlot(slotId, { width: parsed });
      }
    },
    [handleUpdateSlot],
  );

  return {
    slotCustomWidthActive,
    slotCustomWidthInput,
    slotCustomWidthError,
    handleSlotWidthSelectChange,
    handleSlotCustomWidthInputChange,
  };
}

type SlotEditPanelProps = {
  selectedSlot: LayoutSlot;
  isMasonry: boolean;
  aspectRatioOptions: { value: string; label: string }[];
  presetAspectRatioValues: string[];
  slotWidthOptions: { value: string | number; label: string }[];
  spanOptions: {
    rowOptions: number[];
    colOptions: number[];
    rowSpan: number;
    colSpan: number;
  };
  slotCustomWidthActive: boolean;
  slotCustomWidthInput: string;
  slotCustomWidthError: string | undefined;
  slotCustomAspectRatioError: string | undefined;
  onClose: () => void;
  onUpdateSlot: (slotId: string, updates: Partial<LayoutSlot>) => void;
  onSlotWidthSelectChange: (
    slotId: string,
    value: string,
    currentWidth: LayoutSlot['width'],
  ) => void;
  onSlotCustomWidthInputChange: (slotId: string, value: string) => void;
};

function deriveSlotAspectRatioValue(slot: LayoutSlot): string {
  if (slot.aspectRatio === 'custom') return slot.customAspectRatio ?? '';
  return slot.aspectRatio;
}

function deriveSlotAspectRatioSelectValue(
  slot: LayoutSlot,
  presetAspectRatioValues: string[],
): string {
  const isCustom =
    slot.aspectRatio === 'custom' ||
    !presetAspectRatioValues.includes(slot.aspectRatio);
  return isCustom ? 'custom' : slot.aspectRatio;
}

function SlotEditPanel({
  selectedSlot,
  isMasonry,
  aspectRatioOptions,
  presetAspectRatioValues,
  slotWidthOptions,
  spanOptions,
  slotCustomWidthActive,
  slotCustomWidthInput,
  slotCustomWidthError,
  slotCustomAspectRatioError,
  onClose,
  onUpdateSlot,
  onSlotWidthSelectChange,
  onSlotCustomWidthInputChange,
}: SlotEditPanelProps) {
  const isSlotCustomAspectRatio =
    selectedSlot.aspectRatio === 'custom' ||
    !presetAspectRatioValues.includes(selectedSlot.aspectRatio);

  const slotCustomAspectRatioValue = isSlotCustomAspectRatio
    ? deriveSlotAspectRatioValue(selectedSlot)
    : '';

  const aspectRatioSelectValue = deriveSlotAspectRatioSelectValue(
    selectedSlot,
    presetAspectRatioValues,
  );

  function handleAspectRatioChange(value: string) {
    const existingCustomValue = deriveSlotAspectRatioValue(selectedSlot);
    if (value === 'custom') {
      onUpdateSlot(selectedSlot.id, {
        aspectRatio: 'custom',
        customAspectRatio: existingCustomValue || '',
      });
    } else {
      onUpdateSlot(selectedSlot.id, {
        aspectRatio: value,
        customAspectRatio: undefined,
      });
    }
  }

  return (
    <div className={s.editPanel}>
      <div className={s.editPanelHeader}>
        <span className={s.editPanelTitle}>Edit Slot</span>
        <button type="button" className={s.closeButton} onClick={onClose}>
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
              onUpdateSlot(selectedSlot.id, { label: e.target.value })
            }
          />
        </div>

        <div className={s.formRow}>
          <div className={s.formField}>
            <label className={s.formLabel}>Aspect Ratio</label>
            <select
              className={s.formSelect}
              value={aspectRatioSelectValue}
              onChange={(e) => handleAspectRatioChange(e.target.value)}
            >
              {aspectRatioOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {isSlotCustomAspectRatio && (
            <div className={s.formField}>
              <label className={s.formLabel}>Custom Ratio</label>
              <input
                type="text"
                className={
                  slotCustomAspectRatioError
                    ? `${s.formInput} ${s.inputError}`
                    : s.formInput
                }
                value={slotCustomAspectRatioValue}
                placeholder="2.35:1"
                onChange={(e) =>
                  onUpdateSlot(selectedSlot.id, {
                    aspectRatio: 'custom',
                    customAspectRatio: e.target.value,
                  })
                }
              />
              {slotCustomAspectRatioError && (
                <span className={s.errorText}>
                  {slotCustomAspectRatioError}
                </span>
              )}
            </div>
          )}

          <div className={s.formField}>
            <label className={s.formLabel}>Width</label>
            <select
              className={s.formSelect}
              value={slotCustomWidthActive ? 'custom' : selectedSlot.width}
              onChange={(e) =>
                onSlotWidthSelectChange(
                  selectedSlot.id,
                  e.target.value,
                  selectedSlot.width,
                )
              }
            >
              {slotWidthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {slotCustomWidthActive && (
          <div className={s.formRow}>
            <div className={s.formField}>
              <label className={s.formLabel}>Custom Width</label>
              <input
                type="number"
                min={MIN_WIDTH}
                max={MAX_WIDTH}
                className={
                  slotCustomWidthError
                    ? `${s.formInput} ${s.inputError}`
                    : s.formInput
                }
                value={slotCustomWidthInput}
                placeholder={String(DEFAULT_WIDTH)}
                onChange={(e) =>
                  onSlotCustomWidthInputChange(selectedSlot.id, e.target.value)
                }
              />
              {slotCustomWidthError && (
                <span className={s.errorText}>{slotCustomWidthError}</span>
              )}
            </div>
          </div>
        )}

        <div className={s.formRow}>
          <div className={s.formField}>
            <label className={s.formLabel}>Column Span</label>
            <select
              className={s.formSelect}
              value={spanOptions.colSpan}
              onChange={(e) =>
                onUpdateSlot(selectedSlot.id, {
                  colSpan: Number(e.target.value),
                })
              }
            >
              {spanOptions.colOptions.map((span) => (
                <option key={span} value={span}>
                  {span}
                </option>
              ))}
            </select>
          </div>

          {!isMasonry && (
            <div className={s.formField}>
              <label className={s.formLabel}>Row Span</label>
              <select
                className={s.formSelect}
                value={spanOptions.rowSpan}
                onChange={(e) =>
                  onUpdateSlot(selectedSlot.id, {
                    rowSpan: Number(e.target.value),
                  })
                }
              >
                {spanOptions.rowOptions.map((span) => (
                  <option key={span} value={span}>
                    {span}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {!isMasonry && (
          <>
            <label className={s.formCheckbox}>
              <input
                type="checkbox"
                checked={selectedSlot.autoSpan ?? false}
                onChange={(e) =>
                  onUpdateSlot(selectedSlot.id, {
                    autoSpan: e.target.checked,
                  })
                }
              />
              <span>Auto size from aspect ratio</span>
            </label>

            {spanOptions.rowOptions.length === 1 &&
              spanOptions.colOptions.length === 1 && (
                <div className={s.formHint}>
                  Add rows/columns or remove a slot to allow larger spans.
                </div>
              )}
          </>
        )}

        <label className={s.formCheckbox}>
          <input
            type="checkbox"
            checked={selectedSlot.required}
            onChange={(e) =>
              onUpdateSlot(selectedSlot.id, {
                required: e.target.checked,
              })
            }
          />
          <span>Required field</span>
        </label>
      </div>
    </div>
  );
}

export default function LayoutBuilder({
  config,
  onChange,
  widthOptions,
}: Props) {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<CellPosition | null>(null);
  const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
  const draggedSlotIdRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const isMasonry = config.layoutStyle === 'masonry';

  const selectedSlot = selectedSlotId
    ? config.slots.find((s) => s.id === selectedSlotId)
    : null;

  const {
    clampSlotToGrid,
    getSlotSpan,
    buildOccupancy,
    canPlaceAt,
    findBestSpanForSlot,
  } = useGridOccupancy({ config });

  const { getMasonryRowSpan } = useMasonryGridMetrics({ config, gridRef });

  const {
    handleColumnsChange,
    handleRowsChange,
    handleAddSlotAtPosition,
    handleUpdateSlot,
    handleDeleteSlot,
    handleAddSlotMasonry,
  } = useSlotManagement({
    config,
    isMasonry,
    selectedSlotId,
    clampSlotToGrid,
    findBestSpanForSlot,
    onChange,
    setSelectedSlotId,
  });

  const {
    handleDragStart,
    handleDragEnd,
    handleDragOverSlot,
    handleDragOverEmpty,
    handleDragLeave,
    handleDropOnSlot,
    handleDropOnEmpty,
  } = useDragHandlers({
    config,
    isMasonry,
    draggedSlotIdRef,
    getSlotSpan,
    buildOccupancy,
    canPlaceAt,
    onChange,
    setDraggedSlotId,
    setDragOverCell,
    setDragOverSlotId,
  });

  const occupancy = useMemo(
    () => (isMasonry ? [] : buildOccupancy()),
    [buildOccupancy, isMasonry],
  );

  const emptyCells = useMemo(
    () => (isMasonry ? [] : computeEmptyCells(config, occupancy)),
    [config, isMasonry, occupancy],
  );

  const spanOptions = useMemo(
    () =>
      computeSpanOptions(
        selectedSlot,
        isMasonry,
        config,
        buildOccupancy,
        getSlotSpan,
        canPlaceAt,
      ),
    [buildOccupancy, canPlaceAt, config, getSlotSpan, isMasonry, selectedSlot],
  );

  const presetAspectRatioOptions = ASPECT_RATIO_OPTIONS.filter(
    (opt) => opt.value !== 'custom',
  );
  const aspectRatioOptions = [
    ...presetAspectRatioOptions,
    { value: 'custom', label: 'Custom...' },
  ];
  const presetAspectRatioValues = presetAspectRatioOptions.map(
    (opt) => opt.value,
  );

  const layoutPresetAspectRatioOptions = ASPECT_RATIO_OPTIONS.filter(
    (opt) => opt.value !== 'custom' && opt.value !== 'original',
  );
  const layoutAspectRatioOptions = [
    { value: 'auto', label: 'Auto' },
    ...layoutPresetAspectRatioOptions,
    { value: 'custom', label: 'Custom...' },
  ];
  const layoutPresetAspectRatioValues = layoutPresetAspectRatioOptions.map(
    (opt) => opt.value,
  );
  const layoutPresetWidthOptions = widthOptions.filter(
    (opt) => opt.value !== 'original',
  );
  const layoutWidthOptions = [
    ...layoutPresetWidthOptions,
    { value: 'custom', label: 'Custom...' },
  ];
  const layoutPresetWidthValues = layoutPresetWidthOptions.map(
    (opt) => opt.value,
  );

  const layoutAspectRatioSelection = deriveLayoutAspectRatioSelection(
    config.layoutAspectRatio,
    layoutPresetAspectRatioValues,
  );
  const layoutCustomAspectRatioValue = deriveLayoutCustomAspectRatioValue(
    config.layoutAspectRatio,
    config.layoutCustomAspectRatio,
    layoutPresetAspectRatioValues,
  );
  const layoutCustomAspectRatioError =
    layoutAspectRatioSelection === 'custom'
      ? validateCustomAspectRatio(layoutCustomAspectRatioValue)
      : undefined;

  const {
    layoutCustomWidthActive,
    layoutCustomWidthInput,
    layoutCustomWidthError,
    layoutWidthSelection,
    handleLayoutWidthChange,
    handleLayoutCustomWidthInputChange,
  } = useLayoutWidthControls({ config, layoutPresetWidthValues, onChange });

  const layoutDimensions = buildLayoutDimensions(config);

  const slotAspectRatioSelectValue = selectedSlot
    ? deriveSlotAspectRatioSelectValue(selectedSlot, presetAspectRatioValues)
    : null;
  const slotCustomAspectRatioError =
    slotAspectRatioSelectValue === 'custom' && selectedSlot
      ? validateCustomAspectRatio(deriveSlotAspectRatioValue(selectedSlot))
      : undefined;

  const presetWidthValues = useMemo(
    () => new Set(widthOptions.map((opt) => opt.value)),
    [widthOptions],
  );
  const slotWidthOptions = [
    ...widthOptions,
    { value: 'custom', label: 'Custom...' },
  ];

  const {
    slotCustomWidthActive,
    slotCustomWidthInput,
    slotCustomWidthError,
    handleSlotWidthSelectChange,
    handleSlotCustomWidthInputChange,
  } = useSlotWidthControls({
    selectedSlot,
    presetWidthValues,
    handleUpdateSlot,
  });

  const handleLayoutStyleChange = useCallback(
    (newLayoutStyle: 'grid' | 'masonry') =>
      applyLayoutStyleChange(config, newLayoutStyle, onChange),
    [config, onChange],
  );

  const handleLayoutAspectRatioChange = useCallback(
    (value: string) =>
      applyLayoutAspectRatioChange(
        config,
        value,
        layoutCustomAspectRatioValue,
        onChange,
      ),
    [config, layoutCustomAspectRatioValue, onChange],
  );

  return (
    <div className={s.container}>
      <div className={s.toolbar}>
        <div className={s.gridControls}>
          <div className={s.controlGroup}>
            <span className={s.controlLabel}>Layout:</span>
            <select
              value={config.layoutStyle ?? 'grid'}
              onChange={(e) => {
                const layoutStyle =
                  e.target.value === 'masonry' ? 'masonry' : 'grid';
                handleLayoutStyleChange(layoutStyle);
              }}
              className={s.controlSelect}
            >
              <option value="grid">Grid</option>
              <option value="masonry">Masonry</option>
            </select>
          </div>
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

          {!isMasonry && (
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
          )}
        </div>

        <div className={s.gridInfo}>
          {buildSlotCountLabel(config, isMasonry)}
        </div>
      </div>

      <LayoutControls
        config={config}
        layoutAspectRatioOptions={layoutAspectRatioOptions}
        layoutAspectRatioSelection={layoutAspectRatioSelection}
        layoutCustomAspectRatioValue={layoutCustomAspectRatioValue}
        layoutCustomAspectRatioError={layoutCustomAspectRatioError}
        layoutWidthOptions={layoutWidthOptions}
        layoutWidthSelection={layoutWidthSelection}
        layoutCustomWidthActive={layoutCustomWidthActive}
        layoutCustomWidthInput={layoutCustomWidthInput}
        layoutCustomWidthError={layoutCustomWidthError}
        layoutDimensions={layoutDimensions}
        onChange={onChange}
        onLayoutAspectRatioChange={handleLayoutAspectRatioChange}
        onLayoutWidthChange={handleLayoutWidthChange}
        onLayoutCustomWidthInputChange={handleLayoutCustomWidthInputChange}
      />

      {isMasonry && (
        <div className={s.toolbarRow}>
          <button
            type="button"
            className={s.addSlotButton}
            onClick={handleAddSlotMasonry}
          >
            Add slot
          </button>
        </div>
      )}

      <div className={s.gridPreview}>
        <div
          className={s.grid}
          data-layout={isMasonry ? 'masonry' : 'grid'}
          ref={gridRef}
          style={buildGridContainerStyle(config, isMasonry)}
        >
          {config.slots.map((slot) => {
            const { rowSpan, colSpan } = getSlotSpan(slot);
            const masonryRowSpan = isMasonry
              ? getMasonryRowSpan(slot)
              : rowSpan;
            const rawColSpan = slot.colSpan;
            const masonryColSpan =
              typeof rawColSpan === 'number' && rawColSpan > 0
                ? Math.min(rawColSpan, config.columns)
                : 1;
            const slotStyle = deriveSlotGridStyle(
              slot,
              isMasonry,
              colSpan,
              rowSpan,
              masonryColSpan,
              masonryRowSpan,
            );
            const isDragOver = deriveSlotIsDragOver(
              slot,
              isMasonry,
              dragOverSlotId,
              dragOverCell,
            );
            return (
              <SlotItem
                key={slot.id}
                slot={slot}
                widthOptions={widthOptions}
                style={slotStyle}
                isSelected={selectedSlotId === slot.id}
                isDragging={draggedSlotId === slot.id}
                isDragOver={isDragOver}
                onSelect={() => setSelectedSlotId(slot.id)}
                onDelete={() => handleDeleteSlot(slot.id)}
                onDragStart={handleDragStart(slot.id)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOverSlot(slot.id, slot.row, slot.col)}
                onDragLeave={handleDragLeave}
                onDrop={handleDropOnSlot(slot.id)}
                showRatioFrame={!isMasonry}
              />
            );
          })}
          {!isMasonry &&
            emptyCells.map(({ row, col }) => (
              <EmptyCell
                key={`empty-${row}-${col}`}
                row={row}
                col={col}
                style={{
                  gridColumn: `${col + 1} / span 1`,
                  gridRow: `${row + 1} / span 1`,
                }}
                isDragOver={
                  dragOverCell?.row === row && dragOverCell?.col === col
                }
                onAdd={() => handleAddSlotAtPosition(row, col)}
                onDragOver={handleDragOverEmpty(row, col)}
                onDragLeave={handleDragLeave}
                onDrop={handleDropOnEmpty(row, col)}
              />
            ))}
        </div>
      </div>

      {selectedSlot && (
        <SlotEditPanel
          selectedSlot={selectedSlot}
          isMasonry={isMasonry}
          aspectRatioOptions={aspectRatioOptions}
          presetAspectRatioValues={presetAspectRatioValues}
          slotWidthOptions={slotWidthOptions}
          spanOptions={spanOptions}
          slotCustomWidthActive={slotCustomWidthActive}
          slotCustomWidthInput={slotCustomWidthInput}
          slotCustomWidthError={slotCustomWidthError}
          slotCustomAspectRatioError={slotCustomAspectRatioError}
          onClose={() => setSelectedSlotId(null)}
          onUpdateSlot={handleUpdateSlot}
          onSlotWidthSelectChange={handleSlotWidthSelectChange}
          onSlotCustomWidthInputChange={handleSlotCustomWidthInputChange}
        />
      )}
    </div>
  );
}

// Empty cell component
type EmptyCellProps = {
  row: number;
  col: number;
  style?: React.CSSProperties;
  isDragOver: boolean;
  onAdd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};

function EmptyCell({
  style,
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
      style={style}
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
