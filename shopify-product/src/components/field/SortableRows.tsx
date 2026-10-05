import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  KeyboardSensor,
  type Modifier,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { faBars } from '@fortawesome/free-solid-svg-icons';
import { type CSSProperties, type ReactNode, useMemo, useState } from 'react';
import { Icon } from '../../ui/Icon';
import Tip from '../shared/Tip';
import styles from './SortableRows.module.css';
import { useReducedMotion } from './useReducedMotion';

type Item = { key: string; label: string };

/**
 * `sortable`: dnd-kit handles. `inert`: the handle column stays, drawn
 * disabled with a tooltip (a multiple field holding one item), so the rows
 * don't jump sideways when a second item arrives. `none`: no handle column
 * (single values, disabled fields).
 */
export type HandleMode = 'sortable' | 'inert' | 'none';

type Props<T extends Item> = {
  items: readonly T[];
  handles: HandleMode;
  /** The inert handle's tooltip: why reordering isn't available. */
  inertReason?: string | null;
  /**
   * Renders one row. `dragHandle` is the handle column, when there is one;
   * `lifted` marks the copy that follows the pointer.
   */
  renderRow: (
    item: T,
    dragHandle: ReactNode | null,
    lifted: boolean,
  ) => ReactNode;
  onMove: (from: number, to: number) => void;
};

const DROP_ANIMATION: DropAnimation = {
  duration: 200,
  easing: 'cubic-bezier(0.55, 0, 0.1, 1)',
  keyframes: ({ transform: { initial, final } }) => [
    { transform: CSS.Transform.toString(initial), opacity: 1 },
    { transform: CSS.Transform.toString(final), opacity: 0 },
  ],
  sideEffects: null,
};

/** Rows only move up and down. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    'To reorder, press Space or Enter to pick the item up, use the arrow keys to move it, then press Space or Enter again to drop it. Press Escape to cancel.',
};

function buildAnnouncements<T extends Item>(
  items: readonly T[],
): Announcements {
  const labelOf = (id: UniqueIdentifier) =>
    items.find((item) => item.key === String(id))?.label ?? 'Item';
  const positionOf = (id: UniqueIdentifier) =>
    `position ${items.findIndex((item) => item.key === String(id)) + 1} of ${items.length}`;
  return {
    onDragStart: ({ active }) =>
      `Picked up ${labelOf(active.id)}, in ${positionOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${labelOf(active.id)} moved to ${positionOf(over.id)}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${labelOf(active.id)} dropped in ${positionOf(over.id)}.`
        : `${labelOf(active.id)} dropped.`,
    onDragCancel: ({ active }) =>
      `Reordering cancelled. ${labelOf(active.id)} is back in ${positionOf(active.id)}.`,
  };
}

function DragHandle({
  label,
  sortable,
}: {
  label: string;
  sortable: ReturnType<typeof useSortable>;
}) {
  return (
    <button
      type="button"
      ref={sortable.setActivatorNodeRef}
      className={styles.handle}
      {...sortable.attributes}
      {...sortable.listeners}
      aria-label={`Reorder ${label}`}
    >
      <Icon icon={faBars} />
    </button>
  );
}

function SortableItem<T extends Item>({
  item,
  renderRow,
  reducedMotion,
}: {
  item: T;
  renderRow: Props<T>['renderRow'];
  /** Rows snap into place instead of sliding. */
  reducedMotion: boolean;
}) {
  const sortable = useSortable({
    id: item.key,
    ...(reducedMotion ? { transition: null } : {}),
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={sortable.isDragging ? styles.dragging : undefined}
      data-testid="shopify-sortable-row"
    >
      {renderRow(
        item,
        <DragHandle label={item.label} sortable={sortable} />,
        false,
      )}
    </li>
  );
}

/** The lifted copy's handle. */
function StaticHandle() {
  return (
    <span className={styles.handle} aria-hidden="true">
      <Icon icon={faBars} />
    </span>
  );
}

/** A handle drawn disabled (`--color--border`), never removed. */
function InertHandle({ reason }: { reason: string | null }) {
  return (
    <Tip tip={reason} anchor anchorClassName={styles.handleAnchor}>
      <span
        className={`${styles.handle} ${styles.handleInert}`}
        aria-hidden="true"
        data-testid="shopify-inert-handle"
      >
        <Icon icon={faBars} />
      </span>
    </Tip>
  );
}

function StaticRows<T extends Item>({
  items,
  handles,
  inertReason = null,
  renderRow,
}: Omit<Props<T>, 'onMove'>) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.key}>
          {renderRow(
            item,
            handles === 'inert' ? <InertHandle reason={inertReason} /> : null,
            false,
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The rows as a list, sortable with dnd-kit when enabled: mouse, touch, and
 * keyboard (Space, arrows, Space) through a visible handle on each row, with
 * a lifted copy following the pointer.
 */
export default function SortableRows<T extends Item>({
  items,
  handles,
  inertReason = null,
  renderRow,
  onMove,
}: Props<T>) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const keys = useMemo(() => items.map((item) => item.key), [items]);
  const announcements = useMemo(() => buildAnnouncements(items), [items]);
  const activeItem = items.find((item) => item.key === activeKey);

  if (handles !== 'sortable') {
    return (
      <StaticRows
        items={items}
        handles={handles}
        inertReason={inertReason}
        renderRow={renderRow}
      />
    );
  }

  const handleDragStart = ({ active }: DragStartEvent) =>
    setActiveKey(String(active.id));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveKey(null);
    if (!over || active.id === over.id) return;
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{
        announcements,
        screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
      }}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveKey(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <ul className={styles.list}>
          {items.map((item) => (
            <SortableItem
              key={item.key}
              item={item}
              renderRow={renderRow}
              reducedMotion={reducedMotion}
            />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay dropAnimation={reducedMotion ? null : DROP_ANIMATION}>
        {activeItem ? (
          <div className={styles.overlay}>
            {renderRow(activeItem, <StaticHandle />, true)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
