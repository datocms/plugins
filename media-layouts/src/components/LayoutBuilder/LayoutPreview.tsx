import {
  type DragData,
  type DragSource,
  dropTargetClassName,
  getDragData,
  reorder,
  type SortableDropResult,
  SortableItem,
  SortableList,
  useActiveDrag,
  useDraggable,
  useDropTarget,
} from 'datocms-react-ui/dnd';
import FieldWrapper, { useFieldInput } from 'datocms-react-ui/FieldWrapper';
import { useElementLayout } from 'datocms-react-ui/hooks/useElementLayout';
import RawButton from 'datocms-react-ui/RawButton';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AddIcon } from '../../icons';
import type { LayoutConfig, LayoutSlot } from '../../types';
import { getEffectiveRatio } from '../../utils/aspectRatio';
import { slotTitle } from '../../utils/options';
import {
  buildGridContainerStyle,
  buildOccupancy,
  canMoveGridSlotTo,
  canSwapGridSlots,
  computeEmptyCells,
  deriveSlotGridStyle,
  getMasonryColSpan,
  getSlotSpan,
  MASONRY_ROW_HEIGHT,
  moveGridSlotTo,
  orderSlotsForList,
  swapGridSlotPositions,
} from './grid';
import s from './styles.module.css';

// The preview of the layout: the slots in their grid, which the user opens
// with a click and moves with a drag. In a grid, a click on an empty cell
// adds a slot there; in masonry, a drag changes the order of the slots.

/** The kind of the drag of a grid slot: only the cells of the grid take it */
const SLOT_DRAG_KIND = 'media-layouts-slot';

type SlotDragData = DragData & { kind: typeof SLOT_DRAG_KIND; slotId: string };

function classes(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(' ');
}

/** The slot of the layout that a drag carries, or null for another drag */
function findDraggedSlot(
  config: LayoutConfig,
  data: DragData | null,
): LayoutSlot | null {
  if (!data || data.kind !== SLOT_DRAG_KIND) return null;
  return config.slots.find((slot) => slot.id === data.slotId) ?? null;
}

function draggedSlotOf(
  config: LayoutConfig,
  source: DragSource,
): LayoutSlot | null {
  return findDraggedSlot(config, getDragData(source));
}

type UseMasonryGridMetricsArgs = {
  config: LayoutConfig;
  gridRef: RefObject<HTMLDivElement | null>;
};

/**
 * The width of a column and the gap of the grid, measured, and the number of
 * 8px rows that a masonry slot spans to be as tall as its aspect ratio.
 */
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

  return { getMasonryRowSpan, gap: gridMetrics.gap };
}

type SlotTileProps = {
  slot: LayoutSlot;
  open: boolean;
  /** A drag that the slot takes is over it */
  isDropOver?: boolean;
  /** Masonry only: measures the text, so the slot is never shorter */
  bodyRef?: RefObject<HTMLSpanElement | null>;
  onToggleSlot: (slotId: string) => void;
};

/**
 * A slot of the preview: its name (the list of the slots gives its size and
 * whether it needs an asset). The click opens its settings in the list, and
 * closes them.
 */
function SlotTile({
  slot,
  open,
  isDropOver = false,
  bodyRef,
  onToggleSlot,
}: SlotTileProps) {
  return (
    <RawButton
      className={classes(s.tile, open && s.isOpen, isDropOver && s.isDropOver)}
      expandable={{ open }}
      onClick={() => onToggleSlot(slot.id)}
    >
      <span ref={bodyRef} className={s.tileBody}>
        <span className={s.tileTitle}>{slotTitle(slot)}</span>
      </span>
    </RawButton>
  );
}

type GridSlotProps = {
  config: LayoutConfig;
  slot: LayoutSlot;
  open: boolean;
  /** The slot that the user drags now, if any */
  draggedSlot: LayoutSlot | null;
  onToggleSlot: (slotId: string) => void;
  onChange: (config: LayoutConfig) => void;
};

/**
 * A slot of a grid. The user drags it to an empty cell (its top-left goes
 * there) or on another slot (the two swap their top-lefts), when it fits.
 */
function GridSlot({
  config,
  slot,
  open,
  draggedSlot,
  onToggleSlot,
  onChange,
}: GridSlotProps) {
  const { ref: dragRef, isDragging } = useDraggable({
    getData: (): SlotDragData => ({ kind: SLOT_DRAG_KIND, slotId: slot.id }),
  });

  const takes = (dragged: LayoutSlot | null): dragged is LayoutSlot =>
    !!dragged &&
    dragged.id !== slot.id &&
    canSwapGridSlots(config, dragged, slot);

  const { ref: dropRef, isOver } = useDropTarget({
    canDrop: (source) => takes(draggedSlotOf(config, source)),
    onDrop: ({ source }) => {
      const dragged = draggedSlotOf(config, source);
      if (!takes(dragged)) return;
      onChange({
        ...config,
        slots: swapGridSlotPositions(
          config.slots,
          dragged.id,
          slot.id,
          dragged,
          slot,
        ),
      });
    },
  });

  const ref = useCallback(
    (element: HTMLElement | null) => {
      dragRef(element);
      dropRef(element);
    },
    [dragRef, dropRef],
  );

  const refused =
    !!draggedSlot && draggedSlot.id !== slot.id && !takes(draggedSlot);
  const { rowSpan, colSpan } = getSlotSpan(config, slot);

  return (
    <div
      ref={ref}
      className={classes(
        s.cell,
        s.gridCell,
        isDragging && s.isDragging,
        dropTargetClassName({ isOver, refused }),
      )}
      style={deriveSlotGridStyle(slot, false, colSpan, rowSpan, 1, rowSpan)}
    >
      <SlotTile
        slot={slot}
        open={open}
        isDropOver={isOver}
        onToggleSlot={onToggleSlot}
      />
    </div>
  );
}

type EmptyCellProps = {
  config: LayoutConfig;
  row: number;
  col: number;
  draggedSlot: LayoutSlot | null;
  onAddSlotAt: (row: number, col: number) => void;
  onChange: (config: LayoutConfig) => void;
};

/**
 * A free cell of a grid: a click adds a slot in it, and a dragged slot moves
 * its top-left there when it fits.
 */
function EmptyCell({
  config,
  row,
  col,
  draggedSlot,
  onAddSlotAt,
  onChange,
}: EmptyCellProps) {
  const takes = (dragged: LayoutSlot | null): dragged is LayoutSlot =>
    !!dragged && canMoveGridSlotTo(config, dragged, row, col);

  const { ref, isOver } = useDropTarget({
    canDrop: (source) => takes(draggedSlotOf(config, source)),
    onDrop: ({ source }) => {
      const dragged = draggedSlotOf(config, source);
      if (!takes(dragged)) return;
      onChange({
        ...config,
        slots: moveGridSlotTo(config, dragged.id, row, col),
      });
    },
  });

  const refused = !!draggedSlot && !takes(draggedSlot);

  return (
    <div
      ref={ref}
      className={classes(
        s.cell,
        s.gridCell,
        s.emptyCell,
        dropTargetClassName({ isOver, refused }),
      )}
      style={{
        gridColumn: `${col + 1} / span 1`,
        gridRow: `${row + 1} / span 1`,
      }}
    >
      <RawButton
        className={s.addCell}
        ariaLabel={`Add a slot at row ${row + 1}, column ${col + 1}`}
        onClick={() => onAddSlotAt(row, col)}
      >
        <AddIcon />
      </RawButton>
    </div>
  );
}

type GridItem =
  | { kind: 'slot'; row: number; col: number; slot: LayoutSlot }
  | { kind: 'empty'; row: number; col: number };

/** The slots and the free cells of a grid, row by row (the Tab order) */
function buildGridItems(config: LayoutConfig): GridItem[] {
  const slots: GridItem[] = orderSlotsForList(config, false).map(
    ({ slot }) => ({ kind: 'slot', row: slot.row, col: slot.col, slot }),
  );
  const cells: GridItem[] = computeEmptyCells(
    config,
    buildOccupancy(config),
  ).map(({ row, col }) => ({ kind: 'empty', row, col }));
  return [...slots, ...cells].sort((a, b) => a.row - b.row || a.col - b.col);
}

type GridSlotsProps = {
  config: LayoutConfig;
  openSlotId: string | null;
  onToggleSlot: (slotId: string) => void;
  onAddSlotAt: (row: number, col: number) => void;
  onChange: (config: LayoutConfig) => void;
};

/** The cells of a grid: its slots, and its free cells */
function GridSlots({
  config,
  openSlotId,
  onToggleSlot,
  onAddSlotAt,
  onChange,
}: GridSlotsProps) {
  const items = useMemo(() => buildGridItems(config), [config]);
  const activeDrag = useActiveDrag<SlotDragData>(SLOT_DRAG_KIND);
  const draggedSlot = findDraggedSlot(config, activeDrag);

  return (
    <>
      {items.map((item) =>
        item.kind === 'slot' ? (
          <GridSlot
            key={item.slot.id}
            config={config}
            slot={item.slot}
            open={openSlotId === item.slot.id}
            draggedSlot={draggedSlot}
            onToggleSlot={onToggleSlot}
            onChange={onChange}
          />
        ) : (
          <EmptyCell
            key={`empty-${item.row}-${item.col}`}
            config={config}
            row={item.row}
            col={item.col}
            draggedSlot={draggedSlot}
            onAddSlotAt={onAddSlotAt}
            onChange={onChange}
          />
        ),
      )}
    </>
  );
}

type MasonrySlotProps = {
  config: LayoutConfig;
  slot: LayoutSlot;
  index: number;
  open: boolean;
  /** The rows of 8px that the aspect ratio of the slot needs */
  ratioRowSpan: number;
  gap: number;
  onToggleSlot: (slotId: string) => void;
};

/**
 * A slot of a masonry layout. It is as tall as its aspect ratio, or as its
 * text when the text is taller. A drag puts it before or after another slot.
 */
function MasonrySlot({
  config,
  slot,
  index,
  open,
  ratioRowSpan,
  gap,
  onToggleSlot,
}: MasonrySlotProps) {
  const bodyRef = useRef<HTMLSpanElement | null>(null);
  const { height } = useElementLayout(bodyRef);
  const contentRowSpan =
    height > 0 ? Math.ceil((height + gap) / (MASONRY_ROW_HEIGHT + gap)) : 1;
  const rowSpan = Math.max(ratioRowSpan, contentRowSpan);
  const { colSpan } = getSlotSpan(config, slot);

  return (
    <SortableItem id={slot.id} index={index}>
      {({ ref, isDragging, dropIndicator }) => (
        <div
          ref={ref}
          className={classes(s.cell, isDragging && s.isDragging)}
          style={deriveSlotGridStyle(
            slot,
            true,
            colSpan,
            rowSpan,
            getMasonryColSpan(config, slot),
            rowSpan,
          )}
        >
          <SlotTile
            slot={slot}
            open={open}
            bodyRef={bodyRef}
            onToggleSlot={onToggleSlot}
          />
          {dropIndicator}
        </div>
      )}
    </SortableItem>
  );
}

type MasonrySlotsProps = {
  config: LayoutConfig;
  openSlotId: string | null;
  getMasonryRowSpan: (slot: LayoutSlot) => number;
  gap: number;
  onToggleSlot: (slotId: string) => void;
  onChange: (config: LayoutConfig) => void;
};

/** The slots of a masonry layout, in their order, which a drag changes */
function MasonrySlots({
  config,
  openSlotId,
  getMasonryRowSpan,
  gap,
  onToggleSlot,
  onChange,
}: MasonrySlotsProps) {
  const handleDrop = (result: SortableDropResult) =>
    onChange({ ...config, slots: reorder(config.slots, result) });

  return (
    <SortableList axis="horizontal" onDrop={handleDrop}>
      {config.slots.map((slot, index) => (
        <MasonrySlot
          key={slot.id}
          config={config}
          slot={slot}
          index={index}
          open={openSlotId === slot.id}
          ratioRowSpan={getMasonryRowSpan(slot)}
          gap={gap}
          onToggleSlot={onToggleSlot}
        />
      ))}
    </SortableList>
  );
}

type GroupProps = { children: ReactNode };

/**
 * The element of the field: a group named by the label of the field and
 * described by its hint. The buttons in it keep their own names.
 */
function PreviewGroup({ children }: GroupProps) {
  // A group has no invalid or required state: only the name and the hint
  const field = useFieldInput({});

  return (
    <div
      role="group"
      id={field.id}
      aria-labelledby={field['aria-labelledby']}
      aria-describedby={field['aria-describedby']}
      className={s.preview}
    >
      <FieldWrapper.Boundary>{children}</FieldWrapper.Boundary>
    </div>
  );
}

type Props = {
  config: LayoutConfig;
  isMasonry: boolean;
  openSlotId: string | null;
  onToggleSlot: (slotId: string) => void;
  /** Grid only: adds a slot in a free cell */
  onAddSlotAt: (row: number, col: number) => void;
  onChange: (config: LayoutConfig) => void;
};

/**
 * The preview of the layout, as the input of a field: the grid of rows and
 * columns, or the columns of a masonry, with the same placement as the
 * field editor.
 */
export default function LayoutPreview({
  config,
  isMasonry,
  openSlotId,
  onToggleSlot,
  onAddSlotAt,
  onChange,
}: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { getMasonryRowSpan, gap } = useMasonryGridMetrics({
    config,
    gridRef,
  });

  return (
    <PreviewGroup>
      <div
        ref={gridRef}
        className={s.grid}
        data-layout={isMasonry ? 'masonry' : 'grid'}
        style={buildGridContainerStyle(config, isMasonry)}
      >
        {isMasonry ? (
          <MasonrySlots
            config={config}
            openSlotId={openSlotId}
            getMasonryRowSpan={getMasonryRowSpan}
            gap={gap}
            onToggleSlot={onToggleSlot}
            onChange={onChange}
          />
        ) : (
          <GridSlots
            config={config}
            openSlotId={openSlotId}
            onToggleSlot={onToggleSlot}
            onAddSlotAt={onAddSlotAt}
            onChange={onChange}
          />
        )}
      </div>
    </PreviewGroup>
  );
}
