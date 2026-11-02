import CardList from 'datocms-react-ui/CardList';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import EntityRow from 'datocms-react-ui/EntityRow';
import Pill from 'datocms-react-ui/Pill';
import { type JSX, memo, type SVGProps, useMemo } from 'react';
import {
  ActionToggleIcon,
  DeleteIcon,
  MoveDownIcon,
  MoveLeftIcon,
  MoveRightIcon,
  MoveUpIcon,
} from '../../icons';
import type { LayoutConfig, LayoutSlot, WidthOption } from '../../types';
import { describeSize, slotTitle } from '../../utils/options';
import {
  type GridDirection,
  isAtGridEdge,
  type MasonryDirection,
  moveGridSlot,
  moveMasonrySlot,
  orderSlotsForList,
} from './grid';
import SlotForm, { type UpdateSlot } from './SlotForm';
import s from './styles.module.css';

export type SlotMove = GridDirection | MasonryDirection;

type MoveIcon = (props: SVGProps<SVGSVGElement>) => JSX.Element;

type GridMove = {
  direction: GridDirection;
  label: string;
  icon: MoveIcon;
  /** Why the slot can't move, when the cell is out of the grid */
  edgeReason: string;
};

const GRID_MOVES: GridMove[] = [
  {
    direction: 'up',
    label: 'Move up',
    icon: MoveUpIcon,
    edgeReason: 'The slot is already in the top row.',
  },
  {
    direction: 'down',
    label: 'Move down',
    icon: MoveDownIcon,
    edgeReason: 'The slot is already in the bottom row.',
  },
  {
    direction: 'left',
    label: 'Move left',
    icon: MoveLeftIcon,
    edgeReason: 'The slot is already in the first column.',
  },
  {
    direction: 'right',
    label: 'Move right',
    icon: MoveRightIcon,
    edgeReason: 'The slot is already in the last column.',
  },
];

const NO_ROOM_REASON = "There's no room for the slot there.";

type MasonryMove = {
  direction: MasonryDirection;
  label: string;
  icon: MoveIcon;
  reason: string;
};

const MASONRY_MOVES: MasonryMove[] = [
  {
    direction: 'earlier',
    label: 'Move earlier',
    icon: MoveUpIcon,
    reason: 'The slot is already first.',
  },
  {
    direction: 'later',
    label: 'Move later',
    icon: MoveDownIcon,
    reason: 'The slot is already last.',
  },
];

type MoveOption = {
  direction: SlotMove;
  label: string;
  icon: MoveIcon;
  /** Why the move is not possible now; none when it is */
  reason: string | undefined;
};

/** The moves of the "⋮" of a slot, each with the reason it can't happen */
function buildMoveOptions(
  config: LayoutConfig,
  slot: LayoutSlot,
  isMasonry: boolean,
): MoveOption[] {
  if (isMasonry) {
    return MASONRY_MOVES.map(({ direction, label, icon, reason }) => ({
      direction,
      label,
      icon,
      reason: moveMasonrySlot(config, slot.id, direction) ? undefined : reason,
    }));
  }
  return GRID_MOVES.map(({ direction, label, icon, edgeReason }) => {
    let reason: string | undefined;
    if (isAtGridEdge(config, slot, direction)) {
      reason = edgeReason;
    } else if (!moveGridSlot(config, slot.id, direction)) {
      reason = NO_ROOM_REASON;
    }
    return { direction, label, icon, reason };
  });
}

type SlotMenuProps = {
  config: LayoutConfig;
  slot: LayoutSlot;
  isMasonry: boolean;
  onMoveSlot: (slotId: string, move: SlotMove) => void;
  onDeleteSlot: (slotId: string) => void;
};

/**
 * The "⋮" of a slot: the moves (the keyboard way to do what a drag does in
 * the preview), then Delete last.
 */
function SlotMenu({
  config,
  slot,
  isMasonry,
  onMoveSlot,
  onDeleteSlot,
}: SlotMenuProps) {
  return (
    <Dropdown triggerComponent={IconTrigger} icon={ActionToggleIcon}>
      {() => (
        <Dropdown.Menu placement="bottom-end">
          {buildMoveOptions(config, slot, isMasonry).map(
            ({ direction, label, icon: Icon, reason }) => (
              <Dropdown.Option
                key={direction}
                icon={<Icon />}
                disabled={reason ? { reason } : undefined}
                onPick={() => onMoveSlot(slot.id, direction)}
              >
                {label}
              </Dropdown.Option>
            ),
          )}
          <Dropdown.Separator />
          <Dropdown.Option
            icon={<DeleteIcon />}
            alert
            onPick={() => onDeleteSlot(slot.id)}
          >
            Delete
          </Dropdown.Option>
        </Dropdown.Menu>
      )}
    </Dropdown>
  );
}

type SlotSummaryProps = {
  slot: LayoutSlot;
  /** The position of the slot in the slots of the layout */
  index: number;
  isMasonry: boolean;
  widthOptions: WidthOption[];
  errors: Partial<Record<string, string>>;
  /** The settings of the slot are open: their inputs show the errors */
  open: boolean;
};

/** What a closed slot needs, at the end of its row: a label, then a ratio */
function slotProblem(
  slot: LayoutSlot,
  index: number,
  errors: Partial<Record<string, string>>,
): string | undefined {
  if (!(slot.label ?? '').trim()) return 'Needs a label';
  if (errors[`slot_${index}_aspectRatio`]) return 'Fix the aspect ratio';
  return undefined;
}

/**
 * The row of a slot: its name, whether it needs an asset, its crop and size
 * (which only this row gives), and its cell. A closed slot without a label,
 * or with an aspect ratio to fix, says so at the end of the row; its
 * settings show the error on the input.
 */
function SlotSummary({
  slot,
  index,
  isMasonry,
  widthOptions,
  errors,
  open,
}: SlotSummaryProps) {
  const size = describeSize({
    aspectRatio: slot.aspectRatio,
    customAspectRatio: slot.customAspectRatio,
    width: slot.width,
    widthOptions,
  });
  const problem = open ? undefined : slotProblem(slot, index, errors);

  return (
    <EntityRow
      layout="row"
      title={slotTitle(slot)}
      afterTitle={slot.required ? <Pill>Required</Pill> : undefined}
      trailing={problem ? <Pill tone="danger">{problem}</Pill> : undefined}
    >
      {isMasonry
        ? size
        : `${size} · row ${slot.row + 1}, column ${slot.col + 1}`}
    </EntityRow>
  );
}

type SlotListItemProps = {
  config: LayoutConfig;
  slot: LayoutSlot;
  /** The position of the slot in the slots of the layout */
  index: number;
  isMasonry: boolean;
  widthOptions: WidthOption[];
  errors: Partial<Record<string, string>>;
  open: boolean;
  onToggleSlot: (slotId: string) => void;
  onUpdateSlot: UpdateSlot;
  onMoveSlot: (slotId: string, move: SlotMove) => void;
  onDeleteSlot: (slotId: string) => void;
};

/** One slot of the list: its row, its "⋮", and its settings when open. */
const SlotListItem = memo(function SlotListItem({
  config,
  slot,
  index,
  isMasonry,
  widthOptions,
  errors,
  open,
  onToggleSlot,
  onUpdateSlot,
  onMoveSlot,
  onDeleteSlot,
}: SlotListItemProps) {
  return (
    <CardList.Item
      row={{
        summary: (
          <SlotSummary
            slot={slot}
            index={index}
            isMasonry={isMasonry}
            widthOptions={widthOptions}
            errors={errors}
            open={open}
          />
        ),
        actions: (
          <SlotMenu
            config={config}
            slot={slot}
            isMasonry={isMasonry}
            onMoveSlot={onMoveSlot}
            onDeleteSlot={onDeleteSlot}
          />
        ),
      }}
      expandable={{
        open,
        onToggle: () => onToggleSlot(slot.id),
        body: (
          <SlotForm
            config={config}
            slot={slot}
            index={index}
            isMasonry={isMasonry}
            widthOptions={widthOptions}
            errors={errors}
            onUpdateSlot={onUpdateSlot}
          />
        ),
      }}
    />
  );
});

type SlotListProps = {
  config: LayoutConfig;
  isMasonry: boolean;
  widthOptions: WidthOption[];
  errors: Partial<Record<string, string>>;
  openSlotId: string | null;
  onToggleSlot: (slotId: string) => void;
  /** Masonry only: appends a slot (a grid adds slots from its empty cells) */
  onAddSlot: () => void;
  onUpdateSlot: UpdateSlot;
  onMoveSlot: (slotId: string, move: SlotMove) => void;
  onDeleteSlot: (slotId: string) => void;
};

/**
 * The slots of the layout, in one card: in a grid row by row, in masonry in
 * their order. Each row opens the settings of its slot, one at a time. The
 * builder shows it once the layout has a slot.
 */
export default function SlotList({
  config,
  isMasonry,
  widthOptions,
  errors,
  openSlotId,
  onToggleSlot,
  onAddSlot,
  onUpdateSlot,
  onMoveSlot,
  onDeleteSlot,
}: SlotListProps) {
  const entries = useMemo(
    () => orderSlotsForList(config, isMasonry),
    [config, isMasonry],
  );
  return (
    <CardList
      className={s.slotList}
      header={{ title: 'Slots' }}
      add={isMasonry ? { label: 'Add slot', onClick: onAddSlot } : undefined}
    >
      {entries.map(({ slot, index }) => (
        <SlotListItem
          key={slot.id}
          config={config}
          slot={slot}
          index={index}
          isMasonry={isMasonry}
          widthOptions={widthOptions}
          errors={errors}
          open={openSlotId === slot.id}
          onToggleSlot={onToggleSlot}
          onUpdateSlot={onUpdateSlot}
          onMoveSlot={onMoveSlot}
          onDeleteSlot={onDeleteSlot}
        />
      ))}
    </CardList>
  );
}
