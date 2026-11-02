import type { CSSProperties } from 'react';
import { DEFAULT_ASPECT_RATIO, DEFAULT_WIDTH } from '../../constants';
import type { LayoutConfig, LayoutSlot } from '../../types';
import { formatDimensions, getEffectiveRatio } from '../../utils/aspectRatio';
import { AUTO_OPTION_VALUE, CUSTOM_OPTION_VALUE } from '../../utils/options';

// The pure logic of the layout builder: the occupancy of the grid, the spans
// of the slots, the moves and the changes of the layout settings. Nothing
// here renders or keeps state.

/** The id of the slot in each cell of the grid, row by row (null when free) */
export type Occupancy = Array<Array<string | null>>;

export type CellPosition = { row: number; col: number };

export type SlotSpan = { rowSpan: number; colSpan: number };

export type CanPlaceAt = (
  grid: Occupancy,
  row: number,
  col: number,
  rowSpan: number,
  colSpan: number,
) => boolean;

export type GridDirection = 'up' | 'down' | 'left' | 'right';

export type MasonryDirection = 'earlier' | 'later';

export const MASONRY_ROW_HEIGHT = 8;

export function generateSlotId() {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

type SpanCandidate = {
  rowSpan: number;
  colSpan: number;
  error: number;
  area: number;
};

export function isBetterSpanCandidate(
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

export function findBestSpanInGrid(
  grid: Occupancy,
  canPlaceAt: CanPlaceAt,
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

export function markSlotInGrid(
  grid: Occupancy,
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

export function computeGridSpanOptions(
  grid: Occupancy,
  canPlaceAt: CanPlaceAt,
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

export function swapGridSlotPositions(
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

// Spans and occupancy

/** A stored span, or 1 when it is missing or not valid */
function storedSpan(span: number | undefined): number {
  return typeof span === 'number' && span > 0 ? span : 1;
}

export function clampSlotToGrid(
  slot: LayoutSlot,
  columns: number,
  rows: number,
): LayoutSlot {
  const row = slot.row;
  const col = slot.col;
  const rowSpan = storedSpan(slot.rowSpan);
  const colSpan = storedSpan(slot.colSpan);
  return {
    ...slot,
    rowSpan: Math.min(rowSpan, Math.max(1, rows - row)),
    colSpan: Math.min(colSpan, Math.max(1, columns - col)),
  };
}

/** The span of a slot in the grid, clamped to the cells after its top-left */
export function getSlotSpan(config: LayoutConfig, slot: LayoutSlot): SlotSpan {
  const rowSpan = storedSpan(slot.rowSpan);
  const colSpan = storedSpan(slot.colSpan);
  return {
    rowSpan: Math.min(rowSpan, Math.max(1, config.rows - slot.row)),
    colSpan: Math.min(colSpan, Math.max(1, config.columns - slot.col)),
  };
}

/** The column span of a slot in masonry, clamped to the columns */
export function getMasonryColSpan(
  config: LayoutConfig,
  slot: LayoutSlot,
): number {
  return typeof slot.colSpan === 'number' && slot.colSpan > 0
    ? Math.min(slot.colSpan, config.columns)
    : 1;
}

export function buildOccupancy(
  config: LayoutConfig,
  ignoreSlotIds: string[] = [],
): Occupancy {
  const grid: Occupancy = Array.from({ length: config.rows }, () =>
    Array.from({ length: config.columns }, () => null),
  );

  for (const slot of config.slots) {
    if (ignoreSlotIds.includes(slot.id)) continue;
    const { rowSpan, colSpan } = getSlotSpan(config, slot);
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
}

export function canPlaceAt(
  config: LayoutConfig,
  grid: Occupancy,
  row: number,
  col: number,
  rowSpan: number,
  colSpan: number,
): boolean {
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
}

/** `canPlaceAt` for the grid of a layout, in the shape the span search takes */
function placerFor(config: LayoutConfig): CanPlaceAt {
  return (grid, row, col, rowSpan, colSpan) =>
    canPlaceAt(config, grid, row, col, rowSpan, colSpan);
}

/**
 * The span closest to the aspect ratio of the slot among the spans that fit,
 * or null when there is none or when it is the current span.
 */
export function findBestSpanForSlot(
  config: LayoutConfig,
  slot: LayoutSlot,
): SlotSpan | null {
  const ratio =
    getEffectiveRatio(slot.aspectRatio, slot.customAspectRatio) ?? null;
  if (!ratio || ratio <= 0) return null;

  const grid = buildOccupancy(config, [slot.id]);
  const maxRowSpan = config.rows - slot.row;
  const maxColSpan = config.columns - slot.col;
  const currentSpan = getSlotSpan(config, slot);

  const best = findBestSpanInGrid(
    grid,
    placerFor(config),
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
}

export function computeEmptyCells(
  config: LayoutConfig,
  occupancy: Occupancy,
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

export type SpanOptions = {
  rowOptions: number[];
  colOptions: number[];
  rowSpan: number;
  colSpan: number;
};

/**
 * The spans that the settings of a slot offer: in a grid, the spans that fit
 * next to the other slots (the current one always listed); in masonry, a
 * column span from 1 to the number of columns.
 */
export function computeSpanOptions(
  selectedSlot: LayoutSlot | null | undefined,
  isMasonry: boolean,
  config: LayoutConfig,
): SpanOptions {
  if (!selectedSlot) {
    return { rowOptions: [], colOptions: [], rowSpan: 1, colSpan: 1 };
  }

  if (isMasonry) {
    const colSpan = getMasonryColSpan(config, selectedSlot);
    const colOptions = Array.from(
      { length: config.columns },
      (_, idx) => idx + 1,
    );
    return { rowOptions: [1], colOptions, rowSpan: 1, colSpan };
  }

  const grid = buildOccupancy(config, [selectedSlot.id]);
  const { rowSpan, colSpan } = getSlotSpan(config, selectedSlot);
  const maxRowSpan = config.rows - selectedSlot.row;
  const maxColSpan = config.columns - selectedSlot.col;

  const { rowOptions, colOptions } = computeGridSpanOptions(
    grid,
    placerFor(config),
    selectedSlot,
    rowSpan,
    colSpan,
    maxRowSpan,
    maxColSpan,
  );

  return { rowOptions, colOptions, rowSpan, colSpan };
}

// Changes of the slots

/**
 * The label of a new slot: 'Slot N', with the first N from the count of the
 * slots that no slot has, thus two slots never get the same name (after a
 * delete, for example).
 */
function newSlotLabel(slots: LayoutSlot[]): string {
  const labels = new Set(slots.map((slot) => (slot.label ?? '').trim()));
  let number = slots.length + 1;
  while (labels.has(`Slot ${number}`)) {
    number++;
  }
  return `Slot ${number}`;
}

function createSlot(
  config: LayoutConfig,
  position: Pick<LayoutSlot, 'row' | 'col' | 'autoSpan'>,
): LayoutSlot {
  return {
    id: generateSlotId(),
    label: newSlotLabel(config.slots),
    aspectRatio: DEFAULT_ASPECT_RATIO,
    width: DEFAULT_WIDTH,
    row: position.row,
    col: position.col,
    rowSpan: 1,
    colSpan: 1,
    autoSpan: position.autoSpan,
    required: false,
  };
}

/** A new slot of a grid, in the cell that the user clicked */
export function createGridSlot(
  config: LayoutConfig,
  row: number,
  col: number,
): LayoutSlot {
  return createSlot(config, { row, col, autoSpan: false });
}

/** A new slot of a masonry layout, which flows after the others */
export function createMasonrySlot(config: LayoutConfig): LayoutSlot {
  return createSlot(config, { row: 0, col: 0, autoSpan: true });
}

/**
 * A new number of columns. In a grid, the slots out of the columns or the
 * rows go away and the spans shrink to the grid; in masonry, only the column
 * spans shrink.
 */
export function applyColumnsChange(
  config: LayoutConfig,
  columns: number,
  isMasonry: boolean,
): LayoutConfig {
  if (isMasonry) {
    const slots = config.slots.map((slot) => ({
      ...slot,
      colSpan: getMasonryColSpan({ ...config, columns }, slot),
    }));
    return { ...config, columns, slots };
  }
  const slots = config.slots
    .filter((slot) => slot.col < columns && slot.row < config.rows)
    .map((slot) => clampSlotToGrid(slot, columns, config.rows));
  return { ...config, columns, slots };
}

/** A new number of rows: the slots out of the grid go away, spans shrink */
export function applyRowsChange(
  config: LayoutConfig,
  rows: number,
): LayoutConfig {
  const slots = config.slots
    .filter((slot) => slot.row < rows && slot.col < config.columns)
    .map((slot) => clampSlotToGrid(slot, config.columns, rows));
  return { ...config, rows, slots };
}

/**
 * Changes one slot. A span set by hand turns the automatic span off, unless
 * the same change sets it; with the automatic span on, the slot takes the
 * span closest to its aspect ratio.
 */
export function applySlotUpdate(
  config: LayoutConfig,
  slotId: string,
  updates: Partial<LayoutSlot>,
): LayoutConfig {
  const manualSpanChange = 'rowSpan' in updates || 'colSpan' in updates;

  const slots = config.slots.map((slot) => {
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
      const autoSpan = findBestSpanForSlot(config, nextSlot);
      if (autoSpan) {
        nextSlot.rowSpan = autoSpan.rowSpan;
        nextSlot.colSpan = autoSpan.colSpan;
      }
    }

    return nextSlot;
  });
  return { ...config, slots };
}

// Moves

/** The slot fits with its top-left at the cell, next to the other slots */
export function canMoveGridSlotTo(
  config: LayoutConfig,
  slot: LayoutSlot,
  row: number,
  col: number,
): boolean {
  const { rowSpan, colSpan } = getSlotSpan(config, slot);
  const grid = buildOccupancy(config, [slot.id]);
  return canPlaceAt(config, grid, row, col, rowSpan, colSpan);
}

/** The slots after the slot moves its top-left to the cell */
export function moveGridSlotTo(
  config: LayoutConfig,
  slotId: string,
  row: number,
  col: number,
): LayoutSlot[] {
  return config.slots.map((slot) =>
    slot.id === slotId ? { ...slot, row, col } : slot,
  );
}

type CellBox = CellPosition & SlotSpan;

/** Two boxes of cells share at least one cell */
function boxesOverlap(a: CellBox, b: CellBox): boolean {
  return (
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan &&
    a.col < b.col + b.colSpan &&
    b.col < a.col + a.colSpan
  );
}

/**
 * Each slot fits at the top-left of the other, with the two ignored, and
 * the two don't land on the same cells (a wide slot that swaps with its
 * neighbour would cover it).
 */
export function canSwapGridSlots(
  config: LayoutConfig,
  draggedSlot: LayoutSlot,
  targetSlot: LayoutSlot,
): boolean {
  const grid = buildOccupancy(config, [draggedSlot.id, targetSlot.id]);
  const draggedBox: CellBox = {
    row: targetSlot.row,
    col: targetSlot.col,
    ...getSlotSpan(config, draggedSlot),
  };
  const targetBox: CellBox = {
    row: draggedSlot.row,
    col: draggedSlot.col,
    ...getSlotSpan(config, targetSlot),
  };
  const fits = (box: CellBox) =>
    canPlaceAt(config, grid, box.row, box.col, box.rowSpan, box.colSpan);
  return (
    fits(draggedBox) && fits(targetBox) && !boxesOverlap(draggedBox, targetBox)
  );
}

const GRID_STEPS: Record<GridDirection, CellPosition> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

/** The cell one step from the top-left of the slot, or null out of the grid */
function gridMoveTarget(
  config: LayoutConfig,
  slot: LayoutSlot,
  direction: GridDirection,
): CellPosition | null {
  const step = GRID_STEPS[direction];
  const row = slot.row + step.row;
  const col = slot.col + step.col;
  if (row < 0 || col < 0 || row >= config.rows || col >= config.columns) {
    return null;
  }
  return { row, col };
}

/** The slot has no cell one step away in that direction */
export function isAtGridEdge(
  config: LayoutConfig,
  slot: LayoutSlot,
  direction: GridDirection,
): boolean {
  return gridMoveTarget(config, slot, direction) === null;
}

/**
 * Moves a slot one step, with the rules of a drop: the top-left goes one
 * cell in the direction. When that cell holds another slot, the two swap
 * their top-lefts if both fit; when it is free, the slot moves there if it
 * fits. Null when the move is out of the grid or does not fit.
 */
export function moveGridSlot(
  config: LayoutConfig,
  slotId: string,
  direction: GridDirection,
): LayoutSlot[] | null {
  const slot = config.slots.find((candidate) => candidate.id === slotId);
  if (!slot) return null;
  const target = gridMoveTarget(config, slot, direction);
  if (!target) return null;

  const occupancy = buildOccupancy(config, [slot.id]);
  const targetSlotId = occupancy[target.row][target.col];
  if (!targetSlotId) {
    return canMoveGridSlotTo(config, slot, target.row, target.col)
      ? moveGridSlotTo(config, slot.id, target.row, target.col)
      : null;
  }

  const targetSlot = config.slots.find(
    (candidate) => candidate.id === targetSlotId,
  );
  if (!targetSlot || !canSwapGridSlots(config, slot, targetSlot)) return null;
  return swapGridSlotPositions(
    config.slots,
    slot.id,
    targetSlot.id,
    slot,
    targetSlot,
  );
}

/** Swaps a masonry slot with the one before or after it (null at the ends) */
export function moveMasonrySlot(
  config: LayoutConfig,
  slotId: string,
  direction: MasonryDirection,
): LayoutSlot[] | null {
  const index = config.slots.findIndex((slot) => slot.id === slotId);
  if (index < 0) return null;
  const otherIndex = direction === 'earlier' ? index - 1 : index + 1;
  if (otherIndex < 0 || otherIndex >= config.slots.length) return null;
  const slots = [...config.slots];
  slots[index] = config.slots[otherIndex];
  slots[otherIndex] = config.slots[index];
  return slots;
}

// Layout settings

export function applyLayoutStyleChange(
  config: LayoutConfig,
  newLayoutStyle: 'grid' | 'masonry',
): LayoutConfig {
  if (newLayoutStyle !== 'grid') {
    return { ...config, layoutStyle: newLayoutStyle };
  }
  const { columns, rows } = config;
  const maxSlots = columns * rows;
  const reordered = config.slots.slice(0, maxSlots).map((slot, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return { ...slot, row, col, rowSpan: 1, colSpan: 1, autoSpan: false };
  });
  return { ...config, layoutStyle: newLayoutStyle, slots: reordered };
}

export function applyLayoutAspectRatioChange(
  config: LayoutConfig,
  value: string,
  layoutCustomAspectRatioValue: string,
): LayoutConfig {
  if (value === AUTO_OPTION_VALUE) {
    return {
      ...config,
      layoutAspectRatio: undefined,
      layoutCustomAspectRatio: undefined,
    };
  }
  if (value === CUSTOM_OPTION_VALUE) {
    return {
      ...config,
      layoutAspectRatio: CUSTOM_OPTION_VALUE,
      layoutCustomAspectRatio: layoutCustomAspectRatioValue || '',
    };
  }
  return {
    ...config,
    layoutAspectRatio: value,
    layoutCustomAspectRatio: undefined,
  };
}

export function deriveLayoutAspectRatioSelection(
  layoutAspectRatio: string | undefined,
  layoutPresetAspectRatioValues: string[],
): string {
  if (!layoutAspectRatio) return AUTO_OPTION_VALUE;
  const isCustom =
    layoutAspectRatio === CUSTOM_OPTION_VALUE ||
    !layoutPresetAspectRatioValues.includes(layoutAspectRatio);
  return isCustom ? CUSTOM_OPTION_VALUE : layoutAspectRatio;
}

export function deriveLayoutCustomAspectRatioValue(
  layoutAspectRatio: string | undefined,
  layoutCustomAspectRatio: string | undefined,
  layoutPresetAspectRatioValues: string[],
): string {
  if (!layoutAspectRatio) return '';
  if (layoutAspectRatio === CUSTOM_OPTION_VALUE) {
    return layoutCustomAspectRatio ?? '';
  }
  if (!layoutPresetAspectRatioValues.includes(layoutAspectRatio)) {
    return layoutAspectRatio;
  }
  return '';
}

/** The size of the whole layout ('1920 × 1080 px'), when it has both parts */
export function buildLayoutDimensions(config: LayoutConfig): string | null {
  if (!config.layoutAspectRatio || !config.layoutWidth) return null;
  const layoutRatio = getEffectiveRatio(
    config.layoutAspectRatio,
    config.layoutCustomAspectRatio,
  );
  if (!layoutRatio) return null;
  return formatDimensions(config.layoutWidth, layoutRatio);
}

// Slot settings

/** The custom text of a slot ratio, or the stored ratio itself */
export function deriveSlotAspectRatioValue(slot: LayoutSlot): string {
  if (slot.aspectRatio === CUSTOM_OPTION_VALUE) {
    return slot.customAspectRatio ?? '';
  }
  return slot.aspectRatio;
}

export function deriveSlotAspectRatioSelectValue(
  slot: LayoutSlot,
  presetAspectRatioValues: string[],
): string {
  const isCustom =
    slot.aspectRatio === CUSTOM_OPTION_VALUE ||
    !presetAspectRatioValues.includes(slot.aspectRatio);
  return isCustom ? CUSTOM_OPTION_VALUE : slot.aspectRatio;
}

// Preview

export function buildGridContainerStyle(
  config: LayoutConfig,
  isMasonry: boolean,
): CSSProperties {
  const gridTemplateColumns = `repeat(${config.columns}, minmax(0, 1fr))`;
  if (isMasonry) {
    return { gridTemplateColumns, gridAutoRows: `${MASONRY_ROW_HEIGHT}px` };
  }
  return {
    gridTemplateColumns,
    gridTemplateRows: `repeat(${config.rows}, minmax(0, 1fr))`,
  };
}

export function deriveSlotGridStyle(
  slot: LayoutSlot,
  isMasonry: boolean,
  colSpan: number,
  rowSpan: number,
  masonryColSpan: number,
  masonryRowSpan: number,
): CSSProperties {
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

/**
 * The slots in the order the list shows them, each with its index in the
 * slots of the layout (the index of the validation errors): in a grid, row by
 * row; in masonry, the stored order.
 */
export function orderSlotsForList(
  config: LayoutConfig,
  isMasonry: boolean,
): Array<{ slot: LayoutSlot; index: number }> {
  const entries = config.slots.map((slot, index) => ({ slot, index }));
  if (isMasonry) return entries;
  return entries.sort(
    (a, b) => a.slot.row - b.slot.row || a.slot.col - b.slot.col,
  );
}
