import { faLock } from '@fortawesome/free-solid-svg-icons';
import { CaretDownIcon, CaretUpIcon, TextInput } from 'datocms-react-ui';
import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuSelection } from '../../ui/Menu';
import Tip from '../shared/Tip';
import styles from './FilterBar.module.css';

export const LOCKED_TOOLTIP = 'Set in the field settings';
export const DISABLED_IN_COLLECTION_TOOLTIP =
  'Enable this filter in Shopify Search & Discovery to use it inside a collection.';
export const NOT_APPLIED_IN_COLLECTION_TOOLTIP = `Not applied inside this collection. ${DISABLED_IN_COLLECTION_TOOLTIP}`;

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function ChipText({ label, value }: { label: string; value?: string | null }) {
  return (
    <span className={styles.chipText}>
      {value ? (
        <>
          {label}: <span className={styles.chipValue}>{value}</span>
        </>
      ) : (
        label
      )}
    </span>
  );
}

/** A filter the field settings fixed: visible, explained, not editable. */
export function LockedChip({
  label,
  value,
  tooltip = LOCKED_TOOLTIP,
}: {
  label: string;
  value?: string | null;
  tooltip?: string;
}) {
  // The chip can shrink to an ellipsis, so the tooltip repeats it in full.
  const full = value ? `${label}: ${value}` : label;
  return (
    <Tip tip={`${full}. ${tooltip}`} placement="bottom">
      <span
        className={cx(
          styles.chip,
          styles.locked,
          value ? styles.lockedValue : null,
        )}
        tabIndex={0}
      >
        <Icon icon={faLock} className="dl-icon--current" />
        <ChipText label={label} value={value} />
        <span className="dl-sr-only">. {tooltip}</span>
      </span>
    </Tip>
  );
}

/**
 * A filter that can't be used here (inside a collection, by default), with
 * the reason. When the editor had set it, its value stays visible, struck
 * through, so "Clear filters" and coming back to all products make sense.
 */
export function DisabledChip({
  label,
  value,
  kept = false,
  menu = true,
  tooltip = kept
    ? NOT_APPLIED_IN_COLLECTION_TOOLTIP
    : DISABLED_IN_COLLECTION_TOOLTIP,
}: {
  label: string;
  value?: string | null;
  /** The editor set this filter; it's kept but not applied here. */
  kept?: boolean;
  /** Show the caret of a menu chip. */
  menu?: boolean;
  /** Why it's disabled (default: the collection doesn't enable it). */
  tooltip?: string;
}) {
  return (
    <Tip tip={tooltip} placement="bottom">
      <button
        type="button"
        className={cx(styles.chip, styles.disabled, kept && styles.kept)}
        aria-disabled="true"
      >
        <ChipText label={label} value={value} />
        <span className="dl-sr-only">. {tooltip}</span>
        {menu && <CaretDownIcon />}
      </button>
    </Tip>
  );
}

/** A chip that opens a menu of values. */
export function MenuChip({
  label,
  value,
  children,
  alignment = 'left',
  selection = 'single',
}: {
  label: string;
  value?: string | null;
  children: ReactNode;
  alignment?: 'left' | 'right';
  selection?: MenuSelection;
}) {
  return (
    <Menu
      alignment={alignment}
      selection={selection}
      renderTrigger={({ open, triggerProps }) => (
        <button
          {...triggerProps}
          type="button"
          className={cx(styles.chip, value ? styles.active : null)}
        >
          <ChipText label={label} value={value} />
          {open ? <CaretUpIcon /> : <CaretDownIcon />}
        </button>
      )}
    >
      {children}
    </Menu>
  );
}

/** An on/off filter. */
export function ToggleChip({
  label,
  pressed,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(styles.chip, pressed ? styles.active : null)}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      <ChipText label={label} />
    </button>
  );
}

/** Free text (vendors have no list query). */
export function TextChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextInput
      id="shopify-picker-vendor"
      name="shopify-picker-vendor"
      type="text"
      labelText={`Filter by ${label.toLowerCase()}`}
      placeholder={label}
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(next) => onChange(next)}
      className={cx(styles.textChip, value ? styles.textChipActive : null)}
    />
  );
}
