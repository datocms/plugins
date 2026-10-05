import { faEyeSlash } from '@fortawesome/free-regular-svg-icons';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { type RefObject, useLayoutEffect, useRef } from 'react';
import { notVisibleMessage } from '../../lib/fieldValue';
import { nodeImage, nodeTitle } from '../../lib/format';
import {
  maxReachedMessage,
  type PickerLabels,
  selectionCountLabel,
} from '../../lib/pickerSearch';
import type { PickerSelectedEntry, ShopifyKind } from '../../types';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import Thumbnail from '../shared/Thumbnail';
import Tip from '../shared/Tip';
import styles from './SelectionFooter.module.css';
import type { Selection } from './useSelection';

/** Tray tiles: 30px squares, radius 4, like every picker thumbnail. */
const TILE_SIZE = 30;

function entryLabel(entry: PickerSelectedEntry): string {
  return entry.node ? nodeTitle(entry.node) : entry.fallbackLabel;
}

/**
 * Always a square tile: the image; a blank swatch without one (as in the
 * results and the field); the eye-slash for an item the storefront can't see
 * (as in the field's rows). The tooltip names it.
 */
function TrayTile({ entry }: { entry: PickerSelectedEntry }) {
  if (!entry.node) {
    return (
      <span className={styles.unresolvedTile}>
        <Icon icon={faEyeSlash} />
      </span>
    );
  }
  return (
    <Thumbnail image={nodeImage(entry.node)} size={TILE_SIZE} radius={4} />
  );
}

function TrayItem({
  entry,
  kind,
  onRemove,
}: {
  entry: PickerSelectedEntry;
  kind: ShopifyKind;
  onRemove: () => void;
}) {
  const label = entryLabel(entry);
  const tooltip = entry.node ? label : `${label}. ${notVisibleMessage(kind)}`;
  return (
    <li className={styles.item}>
      <Tip tip={tooltip}>
        <span
          className={styles.preview}
          role="img"
          tabIndex={0}
          aria-label={tooltip}
          data-tray-preview=""
        >
          <TrayTile entry={entry} />
        </span>
      </Tip>
      <button
        type="button"
        className={styles.remove}
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <Icon icon={faXmark} className="dl-icon--current" />
      </button>
    </li>
  );
}

type Props = {
  selection: Selection;
  labels: PickerLabels;
  kind: ShopifyKind;
  /** Multiple fields: below this, the footer reminds the editor. */
  min?: number;
  /** Empties the selection (and moves focus off the disabled Clear). */
  onClear: () => void;
  onApply: () => void;
};

function minimumHint(
  count: number,
  min: number | undefined,
  labels: PickerLabels,
) {
  if (!min || count >= min) return null;
  return `Choose at least ${min} ${min === 1 ? labels.one : labels.many}`;
}

/**
 * Removing an item unmounts its focused ✕, so focus moves to the item that
 * took its place, else the previous one, else Apply when the tray empties.
 */
function useFocusAfterRemove(
  count: number,
  trayRef: RefObject<HTMLUListElement | null>,
  actionsRef: RefObject<HTMLDivElement | null>,
) {
  const removedIndex = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the count changes after a removal.
  useLayoutEffect(() => {
    const index = removedIndex.current;
    if (index === null) return;
    removedIndex.current = null;
    const previews = Array.from(
      trayRef.current?.querySelectorAll<HTMLElement>('[data-tray-preview]') ??
        [],
    );
    const target =
      previews[Math.min(index, previews.length - 1)] ??
      actionsRef.current?.querySelector<HTMLElement>('button:last-child');
    target?.focus();
  }, [count]);
  return (index: number) => {
    removedIndex.current = index;
  };
}

/**
 * Multiple fields: the staged selection, Clear, and the one primary action.
 * Single fields: a hint, since clicking an item picks it.
 */
export default function SelectionFooter({
  selection,
  labels,
  kind,
  min,
  onClear,
  onApply,
}: Props) {
  const trayRef = useRef<HTMLUListElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const count = selection.entries.length;
  const willRemove = useFocusAfterRemove(count, trayRef, actionsRef);
  if (!selection.multiple) {
    return (
      <div className={styles.footer}>
        <span className={styles.hint}>{labels.singleHint}</span>
      </div>
    );
  }
  const max = Number.isFinite(selection.max) ? selection.max : undefined;
  const hint = selection.atMax
    ? maxReachedMessage(selection.max, kind)
    : minimumHint(count, min, labels);
  return (
    <div className={styles.footer}>
      <div className={styles.summary}>
        <span className={styles.count} role="status" aria-live="polite">
          {selectionCountLabel(count, max)}
        </span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
      {count > 0 && (
        <ul ref={trayRef} className={styles.tray} aria-label="Selection">
          {selection.entries.map((entry, index) => (
            <TrayItem
              key={entry.key}
              entry={entry}
              kind={kind}
              onRemove={() => {
                willRemove(index);
                selection.remove(entry.key);
              }}
            />
          ))}
        </ul>
      )}
      <div ref={actionsRef} className={styles.actions}>
        <Button buttonSize="s" disabled={count === 0} onClick={onClear}>
          Clear
        </Button>
        <Button buttonType="primary" buttonSize="s" onClick={onApply}>
          Apply selection
        </Button>
      </div>
    </div>
  );
}
