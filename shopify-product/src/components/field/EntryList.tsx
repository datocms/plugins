import Callout from 'datocms-react-ui/Callout';
import CardList from 'datocms-react-ui/CardList';
import {
  type SortableDropResult,
  SortableItem,
  SortableList,
} from 'datocms-react-ui/dnd';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import FieldHint from 'datocms-react-ui/FieldHint';
import type { Message } from 'datocms-react-ui/Message';
import { PlusIcon } from '../../icons';
import {
  addLabel,
  emptyLabel,
  type LimitsSummary,
  type RowModel,
} from '../../lib/fieldValue';
import { counterMessage } from '../../texts';
import type { FieldParametersV1 } from '../../types';
import EntryItem from './EntryRow';
import styles from './FieldParts.module.css';
import {
  type ActionName,
  BUSY_REASON,
  type EditorActions,
} from './useEditorActions';
import { FIELD_ACTION_ATTRIBUTE } from './useFieldFeedback';

type Props = {
  params: FieldParametersV1;
  rows: readonly RowModel[];
  actions: EditorActions;
  limits: LimitsSummary;
  /** `ctx.ui.locale`, for prices. */
  locale: string;
  inventory: boolean;
  readOnly: boolean;
};

/**
 * The rows in one card. A multiple field adds "Add …" in the card's footer
 * (not at the maximum, nor when read-only), and the same action fills the
 * empty slot that stands for the card while the field is empty. With several
 * rows they reorder by drag and drop from the handle in the gutter, or with
 * "Move up" and "Move down" in each row's menu.
 */
export default function EntryList({
  params,
  rows,
  actions,
  limits,
  locale,
  inventory,
  readOnly,
}: Props) {
  const multiple = params.cardinality === 'multiple';
  const reorderable = multiple && !readOnly && rows.length > 1;
  const showAdd = multiple && !readOnly && !limits.atMax;

  const handleDrop = ({ source, destination }: SortableDropResult) =>
    actions.reorder(source.index, destination.index);
  const add = {
    label: addLabel(params.kind),
    icon: PlusIcon,
    onClick: actions.browse,
  };

  return (
    <div
      {...{ [FIELD_ACTION_ATTRIBUTE]: 'add' }}
      // The gutter stays while the list can get handles, so the card doesn't
      // move when a second item arrives or leaves.
      className={multiple && !readOnly ? styles.gutter : undefined}
    >
      {/* Always the same tree, so rows don't remount when reordering
          becomes available: the list is only disabled. */}
      <SortableList disabled={!reorderable} onDrop={handleDrop}>
        <CardList
          // Read-only rows keep only their links: the ⋮ shows on every row.
          actionsVisibility={readOnly ? 'always' : undefined}
          add={showAdd ? add : undefined}
          empty={
            <EmptySlot
              message={emptyLabel(params.kind, params.cardinality)}
              action={readOnly ? undefined : add}
            />
          }
        >
          {rows.map((row, index) => (
            <SortableItem
              key={row.key}
              id={row.key}
              index={index}
              disabled={!reorderable}
              handle
            >
              {(sortable) => (
                <EntryItem
                  row={row}
                  index={index}
                  count={rows.length}
                  locale={locale}
                  inventory={inventory}
                  readOnly={readOnly}
                  reorderable={reorderable}
                  actions={actions}
                  sortable={sortable}
                />
              )}
            </SortableItem>
          ))}
        </CardList>
      </SortableList>
    </div>
  );
}

/**
 * Actions that wait on Shopify while "Add …" stays on screen. The card's add
 * button has no disabled state, so the line under the card says why a click
 * does nothing meanwhile. The picker covers the frame during Browse and
 * Replace, and the other actions are quick writes: a line that flashed for
 * each of them would only make the field jump.
 */
function addWaitsFor(busy: ActionName | null): boolean {
  return busy === 'convert' || busy === 'refresh';
}

/**
 * "3 of 10 products"; at the maximum, also why "Add …" is gone ("3 of 3
 * products. You can't add more products: …"), and while a slow action runs,
 * why "Add …" waits; while empty, the minimum.
 */
function limitsLine(
  limits: LimitsSummary,
  count: number,
  readOnly: boolean,
  busy: ActionName | null,
): Message | null {
  if (count === 0) return readOnly ? null : limits.belowMin;
  const atMaxReason =
    limits.atMax && !limits.aboveMax && !readOnly ? limits.atMaxReason : null;
  const waiting =
    !readOnly && !limits.atMax && addWaitsFor(busy) ? BUSY_REASON : null;
  // The counter has no period; the at-max reason and the wait (never both)
  // are sentences, after it.
  const note = atMaxReason ?? waiting;
  return limits.counter ? counterMessage(limits.counter, note) : note;
}

type LimitsProps = {
  limits: LimitsSummary;
  count: number;
  readOnly: boolean;
  /** The action in progress, if any. */
  busy: ActionName | null;
};

/**
 * Under a multiple field: one quiet line with the counter (and why "Add …"
 * is gone at the maximum, or waits), or the minimum while empty; with items,
 * a value below the minimum or above the maximum is a warning.
 */
export function FieldLimits({ limits, count, readOnly, busy }: LimitsProps) {
  const line = limitsLine(limits, count, readOnly, busy);
  const warning =
    count > 0 && !readOnly ? (limits.aboveMax ?? limits.belowMin) : null;
  return (
    <>
      {line && <FieldHint hint={line} />}
      {warning && (
        <Callout tone="warning" className={styles.limitNotice}>
          {warning}
        </Callout>
      )}
    </>
  );
}
