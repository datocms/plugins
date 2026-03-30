import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  COLUMN_OPTIONS,
  ROW_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_WIDTH,
  ASPECT_RATIO_OPTIONS,
} from '../../constants';
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
import type { LayoutConfig, LayoutSlot, WidthOption } from '../../types';
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

type CellPosition = { row: number; col: number };

const MASONRY_ROW_HEIGHT = 8;

export default function LayoutBuilder({ config, onChange, widthOptions }: Props) {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<CellPosition | null>(null);
  const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
  const draggedSlotIdRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridMetrics, setGridMetrics] = useState({
    columnWidth: 0,
    gap: 0,
  });

  const isMasonry = config.layoutStyle === 'masonry';

  const selectedSlot = selectedSlotId
    ? config.slots.find((s) => s.id === selectedSlotId)
    : null;

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
    []
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
    [config.columns, config.rows]
  );

  const buildOccupancy = useCallback(
    (ignoreSlotIds: string[] = []) => {
      const grid: Array<Array<string | null>> = Array.from(
        { length: config.rows },
        () => Array.from({ length: config.columns }, () => null)
      );

      config.slots.forEach((slot) => {
        if (ignoreSlotIds.includes(slot.id)) return;
        const { rowSpan, colSpan } = getSlotSpan(slot);
        for (let row = slot.row; row < slot.row + rowSpan; row++) {
          for (let col = slot.col; col < slot.col + colSpan; col++) {
            if (row >= 0 && row < config.rows && col >= 0 && col < config.columns) {
              grid[row][col] = slot.id;
            }
          }
        }
      });

      return grid;
    },
    [config.columns, config.rows, config.slots, getSlotSpan]
  );

  const canPlaceAt = useCallback(
    (
      grid: Array<Array<string | null>>,
      row: number,
      col: number,
      rowSpan: number,
      colSpan: number
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
    [config.columns, config.rows]
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

      let best:
        | {
            rowSpan: number;
            colSpan: number;
            error: number;
            area: number;
          }
        | null = null;

      for (let rowSpan = 1; rowSpan <= maxRowSpan; rowSpan++) {
        for (let colSpan = 1; colSpan <= maxColSpan; colSpan++) {
          if (!canPlaceAt(grid, slot.row, slot.col, rowSpan, colSpan)) continue;
          const candidateRatio = colSpan / rowSpan;
          const error = Math.abs(candidateRatio - ratio);
          const area = rowSpan * colSpan;

          if (
            !best ||
            error < best.error - 0.001 ||
            (Math.abs(error - best.error) <= 0.001 && area < best.area)
          ) {
            best = { rowSpan, colSpan, error, area };
          }
        }
      }

      if (!best) return null;
      if (
        best.rowSpan === currentSpan.rowSpan &&
        best.colSpan === currentSpan.colSpan
      ) {
        return null;
      }

      return { rowSpan: best.rowSpan, colSpan: best.colSpan };
    },
    [buildOccupancy, canPlaceAt, config.columns, config.rows, getSlotSpan]
  );

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
      setGridMetrics({
        columnWidth,
        gap,
      });
    };

    computeMetrics();
    const observer = new ResizeObserver(() => computeMetrics());
    observer.observe(element);
    return () => observer.disconnect();
  }, [config.columns, isMasonry]);

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

  const handleColumnsChange = useCallback(
    (columns: number) => {
      // Filter out slots that would be outside the new grid
      const validSlots = isMasonry
        ? config.slots
        : config.slots.filter(
            (slot) => slot.col < columns && slot.row < config.rows
          );
      const normalizedSlots = validSlots.map((slot) => {
        if (isMasonry) {
          const colSpan =
            typeof slot.colSpan === 'number' && slot.colSpan > 0
              ? Math.min(slot.colSpan, columns)
              : 1;
          return {
            ...slot,
            colSpan,
          };
        }
        return clampSlotToGrid(slot, columns, config.rows);
      });
      onChange({ ...config, columns, slots: normalizedSlots });
    },
    [clampSlotToGrid, config, isMasonry, onChange]
  );

  const handleRowsChange = useCallback(
    (rows: number) => {
      // Filter out slots that would be outside the new grid
      const validSlots = config.slots.filter(
        (slot) => slot.row < rows && slot.col < config.columns
      );
      const normalizedSlots = validSlots.map((slot) =>
        clampSlotToGrid(slot, config.columns, rows)
      );
      onChange({ ...config, rows, slots: normalizedSlots });
    },
    [clampSlotToGrid, config, onChange]
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
    [config, onChange]
  );

  const handleUpdateSlot = useCallback(
    (slotId: string, updates: Partial<LayoutSlot>) => {
      const manualSpanChange =
        Object.prototype.hasOwnProperty.call(updates, 'rowSpan') ||
        Object.prototype.hasOwnProperty.call(updates, 'colSpan');

      const newSlots = config.slots.map((slot) => {
        if (slot.id !== slotId) return slot;
        const resolvedAutoSpan =
          updates.autoSpan ?? slot.autoSpan ?? false;
        const nextSlot: LayoutSlot = {
          ...slot,
          ...updates,
          autoSpan:
            manualSpanChange && updates.autoSpan === undefined
              ? false
              : resolvedAutoSpan,
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
    [config, findBestSpanForSlot, onChange]
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
  }, [config, onChange]);

  // Drag handlers for slots
  const handleDragStart = useCallback(
    (slotId: string) => (e: React.DragEvent) => {
      setDraggedSlotId(slotId);
      draggedSlotIdRef.current = slotId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', slotId);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDraggedSlotId(null);
    draggedSlotIdRef.current = null;
    setDragOverCell(null);
    setDragOverSlotId(null);
  }, []);

  // Drag over a slot (swap)
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
    [isMasonry]
  );

  // Drag over an empty cell
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
      getSlotSpan,
      isMasonry,
    ]
  );

  const handleDragLeave = useCallback(() => {
    setDragOverCell(null);
    setDragOverSlotId(null);
  }, []);

  // Drop on a slot (swap positions)
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
        const newSlots = [...config.slots];
        const draggedIndex = newSlots.findIndex((slot) => slot.id === activeDragId);
        const targetIndex = newSlots.findIndex((slot) => slot.id === targetSlotId);
        if (draggedIndex >= 0 && targetIndex >= 0 && draggedIndex !== targetIndex) {
          const [moved] = newSlots.splice(draggedIndex, 1);
          const insertIndex =
            draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
          newSlots.splice(insertIndex, 0, moved);
          onChange({ ...config, slots: newSlots });
        }
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
        draggedSpan.colSpan
      );
      const targetFits = canPlaceAt(
        grid,
        draggedSlot.row,
        draggedSlot.col,
        targetSpan.rowSpan,
        targetSpan.colSpan
      );

      if (draggedFits && targetFits) {
        // Swap positions
        const newSlots = config.slots.map((slot) => {
          if (slot.id === activeDragId) {
            return { ...slot, row: targetSlot.row, col: targetSlot.col };
          }
          if (slot.id === targetSlotId) {
            return { ...slot, row: draggedSlot.row, col: draggedSlot.col };
          }
          return slot;
        });

        onChange({ ...config, slots: newSlots });
      }
      setDraggedSlotId(null);
      draggedSlotIdRef.current = null;
    },
    [
      buildOccupancy,
      canPlaceAt,
      config,
      getSlotSpan,
      isMasonry,
      onChange,
    ]
  );

  // Drop on an empty cell (move to that position)
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
        slot.id === activeDragId ? { ...slot, row, col } : slot
      );

      onChange({ ...config, slots: newSlots });
      setDraggedSlotId(null);
      draggedSlotIdRef.current = null;
    },
    [
      buildOccupancy,
      canPlaceAt,
      config,
      getSlotSpan,
      isMasonry,
      onChange,
    ]
  );

  const occupancy = useMemo(
    () => (isMasonry ? [] : buildOccupancy()),
    [buildOccupancy, isMasonry]
  );

  const emptyCells = useMemo(() => {
    if (isMasonry) return [];
    const cells: CellPosition[] = [];
    for (let row = 0; row < config.rows; row++) {
      for (let col = 0; col < config.columns; col++) {
        if (!occupancy[row][col]) {
          cells.push({ row, col });
        }
      }
    }
    return cells;
  }, [config.columns, config.rows, isMasonry, occupancy]);

  const spanOptions = useMemo(() => {
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
        (_, idx) => idx + 1
      );
      return { rowOptions: [1], colOptions, rowSpan: 1, colSpan };
    }

    const grid = buildOccupancy([selectedSlot.id]);
    const { rowSpan, colSpan } = getSlotSpan(selectedSlot);
    const maxRowSpan = config.rows - selectedSlot.row;
    const maxColSpan = config.columns - selectedSlot.col;

    const rowOptions = [];
    for (let span = 1; span <= maxRowSpan; span++) {
      if (canPlaceAt(grid, selectedSlot.row, selectedSlot.col, span, colSpan)) {
        rowOptions.push(span);
      }
    }

    const colOptions = [];
    for (let span = 1; span <= maxColSpan; span++) {
      if (canPlaceAt(grid, selectedSlot.row, selectedSlot.col, rowSpan, span)) {
        colOptions.push(span);
      }
    }

    if (!rowOptions.includes(rowSpan)) {
      rowOptions.unshift(rowSpan);
    }
    if (!colOptions.includes(colSpan)) {
      colOptions.unshift(colSpan);
    }

    return { rowOptions, colOptions, rowSpan, colSpan };
  }, [
    buildOccupancy,
    canPlaceAt,
    config.columns,
    config.rows,
    getSlotSpan,
    isMasonry,
    selectedSlot,
  ]);

  const presetAspectRatioOptions = ASPECT_RATIO_OPTIONS.filter(
    (opt) => opt.value !== 'custom'
  );
  const aspectRatioOptions = [
    ...presetAspectRatioOptions,
    { value: 'custom', label: 'Custom...' },
  ];
  const presetAspectRatioValues = presetAspectRatioOptions.map((opt) => opt.value);

  const layoutPresetAspectRatioOptions = ASPECT_RATIO_OPTIONS.filter(
    (opt) => opt.value !== 'custom' && opt.value !== 'original'
  );
  const layoutAspectRatioOptions = [
    { value: 'auto', label: 'Auto' },
    ...layoutPresetAspectRatioOptions,
    { value: 'custom', label: 'Custom...' },
  ];
  const layoutPresetAspectRatioValues = layoutPresetAspectRatioOptions.map(
    (opt) => opt.value
  );
  const layoutPresetWidthOptions = widthOptions.filter(
    (opt) => opt.value !== 'original'
  );
  const layoutWidthOptions = [
    ...layoutPresetWidthOptions,
    { value: 'custom', label: 'Custom...' },
  ];
  const layoutPresetWidthValues = layoutPresetWidthOptions.map((opt) => opt.value);
  const layoutWidthIsCustomValue =
    typeof config.layoutWidth === 'number' &&
    !layoutPresetWidthValues.includes(config.layoutWidth);
  const [layoutCustomWidthActive, setLayoutCustomWidthActive] = useState(
    layoutWidthIsCustomValue
  );
  const [layoutCustomWidthInput, setLayoutCustomWidthInput] = useState(
    layoutWidthIsCustomValue && config.layoutWidth
      ? String(config.layoutWidth)
      : ''
  );
  const layoutCustomWidthError = layoutCustomWidthActive
    ? validateCustomWidth(layoutCustomWidthInput)
    : undefined;
  const layoutWidthSelection =
    config.layoutWidth === undefined
      ? 'auto'
      : layoutCustomWidthActive
        ? 'custom'
        : String(config.layoutWidth);
  const layoutAspectRatioSelection = config.layoutAspectRatio
    ? config.layoutAspectRatio === 'custom' ||
      !layoutPresetAspectRatioValues.includes(config.layoutAspectRatio)
      ? 'custom'
      : config.layoutAspectRatio
    : 'auto';
  const layoutCustomAspectRatioValue =
    config.layoutAspectRatio === 'custom'
      ? config.layoutCustomAspectRatio ?? ''
      : config.layoutAspectRatio &&
          !layoutPresetAspectRatioValues.includes(config.layoutAspectRatio)
        ? config.layoutAspectRatio
        : '';
  const layoutCustomAspectRatioError =
    layoutAspectRatioSelection === 'custom'
      ? validateCustomAspectRatio(layoutCustomAspectRatioValue)
      : undefined;
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
  const layoutRatio = config.layoutAspectRatio
    ? getEffectiveRatio(
        config.layoutAspectRatio,
        config.layoutCustomAspectRatio
      )
    : null;
  const layoutDimensions =
    layoutRatio && config.layoutWidth
      ? formatDimensions(config.layoutWidth, layoutRatio)
      : null;

  const isSlotCustomAspectRatio =
    !!selectedSlot &&
    (selectedSlot.aspectRatio === 'custom' ||
      !presetAspectRatioValues.includes(selectedSlot.aspectRatio));
  const slotCustomAspectRatioValue = isSlotCustomAspectRatio
    ? selectedSlot?.aspectRatio === 'custom'
      ? selectedSlot.customAspectRatio ?? ''
      : selectedSlot?.aspectRatio ?? ''
    : '';
  const slotCustomAspectRatioError = isSlotCustomAspectRatio
    ? validateCustomAspectRatio(slotCustomAspectRatioValue)
    : undefined;

  const presetWidthValues = useMemo(
    () => new Set(widthOptions.map((opt) => opt.value)),
    [widthOptions]
  );
  const slotWidthOptions = [
    ...widthOptions,
    { value: 'custom', label: 'Custom...' },
  ];
  const slotWidthIsCustomValue =
    !!selectedSlot &&
    typeof selectedSlot.width === 'number' &&
    !presetWidthValues.has(selectedSlot.width);
  const [slotCustomWidthActive, setSlotCustomWidthActive] = useState(
    slotWidthIsCustomValue
  );
  const [slotCustomWidthInput, setSlotCustomWidthInput] = useState(
    slotWidthIsCustomValue ? String(selectedSlot?.width ?? '') : ''
  );
  const slotCustomWidthError = slotCustomWidthActive
    ? validateCustomWidth(slotCustomWidthInput)
    : undefined;
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
  }, [presetWidthValues, selectedSlot, selectedSlotId]);

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
                if (layoutStyle === 'grid') {
                  const columns = config.columns;
                  const rows = config.rows;
                  const maxSlots = columns * rows;
                  const reordered = config.slots.slice(0, maxSlots).map((slot, index) => {
                    const row = Math.floor(index / columns);
                    const col = index % columns;
                    return {
                      ...slot,
                      row,
                      col,
                      rowSpan: 1,
                      colSpan: 1,
                      autoSpan: false,
                    };
                  });
                  onChange({ ...config, layoutStyle, slots: reordered });
                } else {
                  onChange({ ...config, layoutStyle });
                }
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
          {isMasonry
            ? `${config.slots.length} slots`
            : `${config.slots.length} / ${config.rows * config.columns} slots`}
        </div>
      </div>

      <div className={s.layoutControls}>
        <div className={s.controlGroup}>
          <span className={s.controlLabel}>Layout AR:</span>
          <select
            value={layoutAspectRatioSelection}
            onChange={(e) => {
              const value = e.target.value;
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
            }}
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
            onChange={(e) => {
              const value = e.target.value;
              if (value === 'auto') {
                setLayoutCustomWidthActive(false);
                setLayoutCustomWidthInput('');
                onChange({
                  ...config,
                  layoutWidth: undefined,
                });
                return;
              }
              if (value === 'custom') {
                const fallback =
                  typeof config.layoutWidth === 'number'
                    ? config.layoutWidth
                    : DEFAULT_WIDTH;
                setLayoutCustomWidthActive(true);
                setLayoutCustomWidthInput(String(fallback));
                onChange({
                  ...config,
                  layoutWidth: fallback,
                });
                return;
              }
              setLayoutCustomWidthActive(false);
              setLayoutCustomWidthInput('');
              onChange({
                ...config,
                layoutWidth: Number(value),
              });
            }}
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
                onChange={(e) => {
                  const value = e.target.value;
                  setLayoutCustomWidthInput(value);
                  const parsed = parseCustomWidth(value);
                  if (parsed !== null && !validateCustomWidth(value)) {
                    onChange({
                      ...config,
                      layoutWidth: parsed,
                    });
                  }
                }}
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
          style={{
            gridTemplateColumns: `repeat(${config.columns}, minmax(0, 1fr))`,
            ...(isMasonry
              ? {
                  gridAutoRows: `${MASONRY_ROW_HEIGHT}px`,
                }
              : {
                  gridTemplateRows: `repeat(${config.rows}, minmax(0, 1fr))`,
                }),
          }}
        >
          {config.slots.map((slot) => {
            const { rowSpan, colSpan } = getSlotSpan(slot);
            const masonryRowSpan = isMasonry ? getMasonryRowSpan(slot) : rowSpan;
            const masonryColSpan =
              typeof slot.colSpan === 'number' && slot.colSpan > 0
                ? Math.min(slot.colSpan, config.columns)
                : 1;
            return (
              <SlotItem
                key={slot.id}
                slot={slot}
                widthOptions={widthOptions}
                style={{
                  gridColumn: isMasonry
                    ? `span ${masonryColSpan}`
                    : `${slot.col + 1} / span ${colSpan}`,
                  gridRow: isMasonry
                    ? `span ${masonryRowSpan}`
                    : `${slot.row + 1} / span ${rowSpan}`,
                }}
                isSelected={selectedSlotId === slot.id}
                isDragging={draggedSlotId === slot.id}
                isDragOver={
                  isMasonry
                    ? dragOverSlotId === slot.id
                    : dragOverCell?.row === slot.row && dragOverCell?.col === slot.col
                }
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
                isDragOver={dragOverCell?.row === row && dragOverCell?.col === col}
                onAdd={() => handleAddSlotAtPosition(row, col)}
                onDragOver={handleDragOverEmpty(row, col)}
                onDragLeave={handleDragLeave}
                onDrop={handleDropOnEmpty(row, col)}
              />
            ))}
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
                  value={
                    selectedSlot.aspectRatio === 'custom' ||
                    !presetAspectRatioValues.includes(selectedSlot.aspectRatio)
                      ? 'custom'
                      : selectedSlot.aspectRatio
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    const customValue =
                      selectedSlot.aspectRatio === 'custom'
                        ? selectedSlot.customAspectRatio ?? ''
                        : !presetAspectRatioValues.includes(selectedSlot.aspectRatio)
                          ? selectedSlot.aspectRatio
                          : '';

                    if (value === 'custom') {
                      handleUpdateSlot(selectedSlot.id, {
                        aspectRatio: 'custom',
                        customAspectRatio: customValue || '',
                      });
                    } else {
                      handleUpdateSlot(selectedSlot.id, {
                        aspectRatio: value,
                        customAspectRatio: undefined,
                      });
                    }
                  }}
                >
                  {aspectRatioOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {(selectedSlot.aspectRatio === 'custom' ||
                !presetAspectRatioValues.includes(selectedSlot.aspectRatio)) && (
                <div className={s.formField}>
                  <label className={s.formLabel}>Custom Ratio</label>
                  <input
                    type="text"
                    className={
                      slotCustomAspectRatioError
                        ? `${s.formInput} ${s.inputError}`
                        : s.formInput
                    }
                    value={
                      selectedSlot.aspectRatio === 'custom'
                        ? selectedSlot.customAspectRatio ?? ''
                        : selectedSlot.aspectRatio
                    }
                    placeholder="2.35:1"
                    onChange={(e) =>
                      handleUpdateSlot(selectedSlot.id, {
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
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === 'custom') {
                      const fallback =
                        typeof selectedSlot.width === 'number'
                          ? selectedSlot.width
                          : DEFAULT_WIDTH;
                      setSlotCustomWidthActive(true);
                      setSlotCustomWidthInput(String(fallback));
                      handleUpdateSlot(selectedSlot.id, { width: fallback });
                      return;
                    }
                    setSlotCustomWidthActive(false);
                    setSlotCustomWidthInput('');
                    handleUpdateSlot(selectedSlot.id, {
                      width: value === 'original' ? 'original' : Number(value),
                    });
                  }}
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
                    onChange={(e) => {
                      const value = e.target.value;
                      setSlotCustomWidthInput(value);
                      const parsed = parseCustomWidth(value);
                      if (parsed !== null && !validateCustomWidth(value)) {
                        handleUpdateSlot(selectedSlot.id, { width: parsed });
                      }
                    }}
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
                    handleUpdateSlot(selectedSlot.id, {
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
                      handleUpdateSlot(selectedSlot.id, {
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
                      handleUpdateSlot(selectedSlot.id, {
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
