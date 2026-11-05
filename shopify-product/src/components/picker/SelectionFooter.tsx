import Button from 'datocms-react-ui/Button';
import EntityRow from 'datocms-react-ui/EntityRow';
import Toolbar from 'datocms-react-ui/Toolbar';
import { type RefObject, useLayoutEffect, useRef } from 'react';
import { EyeSlashIcon, KindIcon, XmarkIcon } from '../../icons';
import { nodeImage, nodeKind, nodeTitle } from '../../lib/format';
import {
  type PickerLabels,
  selectionCountLabel,
  VARIANTS_OPEN_HINT,
} from '../../lib/pickerSearch';
import type { PickerSelectedEntry, ShopifyKind } from '../../types';
import Thumbnail from '../shared/Thumbnail';
import styles from './PickerBars.module.css';
import { variantLabel } from './ResultItems';
import type { Selection } from './useSelection';

/**
 * A variant leads with its options ("Ice · The Complete Snowboard"), so a
 * chip cut short loses the end of the product's name, not the variant.
 */
function entryLabel(entry: PickerSelectedEntry): string {
  const { node } = entry;
  if (!node) return entry.fallbackLabel;
  if (node.__typename !== 'ProductVariant') return nodeTitle(node);
  const variant = variantLabel(node);
  return variant === node.product.title
    ? variant
    : `${variant} · ${node.product.title}`;
}

/**
 * One selected item: its image (the icon of its kind without one, the
 * eye-slash for an item the storefront can't see, as in the field's rows),
 * its title and the cross that removes it from the selection.
 */
function TrayChip({
  entry,
  onRemove,
}: {
  entry: PickerSelectedEntry;
  onRemove: () => void;
}) {
  const label = entryLabel(entry);
  return (
    <li className={styles.chip}>
      <EntityRow
        layout="inline"
        image={
          <Thumbnail
            image={entry.node ? nodeImage(entry.node) : null}
            fallback={
              entry.node ? (
                <KindIcon kind={nodeKind(entry.node)} />
              ) : (
                <EyeSlashIcon />
              )
            }
          />
        }
        title={label}
        aside={entry.node ? undefined : 'Not visible'}
      />
      <Button
        tone="ghost"
        size="micro"
        iconOnly
        icon={XmarkIcon}
        label={`Remove ${label}`}
        onClick={onRemove}
      />
    </li>
  );
}

/**
 * Removing an item unmounts its focused cross, so focus moves to the cross
 * of the item that took its place, else the previous one, else Apply when
 * the tray empties.
 */
function useFocusAfterRemove(
  count: number,
  trayRef: RefObject<HTMLUListElement | null>,
  applyRef: RefObject<HTMLElement | null>,
) {
  const removedIndex = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the count changes after a removal.
  useLayoutEffect(() => {
    const index = removedIndex.current;
    if (index === null) return;
    removedIndex.current = null;
    const crosses = Array.from(
      trayRef.current?.querySelectorAll<HTMLElement>('li button') ?? [],
    );
    const target =
      crosses[Math.min(index, crosses.length - 1)] ?? applyRef.current;
    target?.focus();
  }, [count]);
  return (index: number) => {
    removedIndex.current = index;
  };
}

type Props = {
  selection: Selection;
  labels: PickerLabels;
  kind: ShopifyKind;
  /** Multiple fields: below this, the count reminds the editor. */
  min?: number;
  /**
   * Why the items that aren't selected can't be picked, once the selection
   * is full: a sentence after the count.
   */
  atMaxReason: string | null;
  /** `ctx.ui.locale`, for the numbers of the count. */
  locale: string;
  /** Empties the selection (and moves focus off the disabled Clear). */
  onClear: () => void;
  onApply: () => void;
};

/**
 * The fixed bottom of a multiple field's picker: the count first, with the
 * limits ("· at least 2" below the minimum; once the selection is full, why
 * nothing else can be picked: "3 of 3 products selected. You can't select
 * more."), the staged selection in the free width (its chips wrap), then
 * Clear and the one primary action, which waits for a change to the field's
 * selection. A single field's footer is only its hint: its
 * first pick resolves the picker. A variant picker says, until the first
 * pick, that a product with several variants opens.
 */
export default function SelectionFooter({
  selection,
  labels,
  kind,
  min,
  atMaxReason,
  locale,
  onClear,
  onApply,
}: Props) {
  const trayRef = useRef<HTMLUListElement>(null);
  const applyRef = useRef<HTMLElement>(null);
  const count = selection.entries.length;
  const willRemove = useFocusAfterRemove(count, trayRef, applyRef);

  const max = Number.isFinite(selection.max) ? selection.max : undefined;
  const counted = selectionCountLabel(count, kind, max, { min, locale });
  return (
    <Toolbar>
      <Toolbar.Subtitle>
        <span role="status" aria-live="polite">
          {atMaxReason ? `${counted}. ${atMaxReason}` : counted}
        </span>
        {count === 0 && kind === 'variant' && `. ${VARIANTS_OPEN_HINT}`}
      </Toolbar.Subtitle>
      {/* The tray takes the free width, and gives it up first. */}
      {count > 0 ? (
        <Toolbar.Fill className={styles.trayPart}>
          <ul
            ref={trayRef}
            className={styles.tray}
            aria-label={`Selected ${labels.many}`}
          >
            {selection.entries.map((entry, index) => (
              <TrayChip
                key={entry.key}
                entry={entry}
                onRemove={() => {
                  willRemove(index);
                  selection.remove(entry.key);
                }}
              />
            ))}
          </ul>
        </Toolbar.Fill>
      ) : (
        <Toolbar.Space />
      )}
      <Toolbar.Button
        label="Clear"
        disabled={count === 0 ? { reason: 'Nothing is selected.' } : undefined}
        onClick={onClear}
      />
      <Toolbar.Button
        ref={applyRef}
        tone="primary"
        label="Apply selection"
        disabled={
          selection.changed ? undefined : { reason: 'Nothing has changed yet.' }
        }
        onClick={onApply}
      />
    </Toolbar>
  );
}
