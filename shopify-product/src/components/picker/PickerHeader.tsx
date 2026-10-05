import {
  faList,
  faMagnifyingGlass,
  faTableCellsLarge,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { TextInput } from 'datocms-react-ui';
import { type ReactNode, type RefObject, useEffect } from 'react';
import { Icon } from '../../ui/Icon';
import Tip from '../shared/Tip';
import styles from './PickerHeader.module.css';
import type { PickerView } from './usePickerView';

type SearchFieldProps = {
  value: string;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  /** The input, also where focus goes when the control that had it leaves. */
  inputRef: RefObject<HTMLInputElement | null>;
};

/** The search input, focused when the picker opens. */
export function SearchField({
  value,
  label,
  placeholder,
  onChange,
  inputRef,
}: SearchFieldProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className={styles.search}>
      <span className={styles.searchIcon} aria-hidden="true">
        <Icon icon={faMagnifyingGlass} />
      </span>
      <TextInput
        id="shopify-picker-search"
        name="shopify-picker-search"
        type="search"
        labelText={label}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(next) => onChange(next)}
        inputRef={inputRef as RefObject<HTMLInputElement>}
        className={styles.searchInput}
      />
      {value !== '' && (
        <Tip tip="Clear search">
          <button
            type="button"
            className={`dl-icon-button ${styles.clearSearch}`}
            aria-label="Clear search"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
          >
            <Icon icon={faXmark} />
          </button>
        </Tip>
      )}
    </div>
  );
}

const VIEWS: Array<{ view: PickerView; label: string; icon: typeof faList }> = [
  { view: 'grid', label: 'Grid view', icon: faTableCellsLarge },
  { view: 'list', label: 'List view', icon: faList },
];

/** Grid or list: a segmented control of two icon buttons. */
export function ViewToggle({
  view,
  onChange,
}: {
  view: PickerView;
  onChange: (view: PickerView) => void;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label="Layout">
      {VIEWS.map((option) => (
        <Tip key={option.view} tip={option.label}>
          <button
            type="button"
            className={styles.segment}
            aria-pressed={view === option.view}
            aria-label={option.label}
            onClick={() => onChange(option.view)}
          >
            <Icon icon={option.icon} className="dl-icon--current" />
          </button>
        </Tip>
      ))}
    </div>
  );
}

/** Row 1 of the picker header. */
export function HeaderRow({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

export function Header({ children }: { children: ReactNode }) {
  return <div className={styles.header}>{children}</div>;
}
