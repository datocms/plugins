import styles from './Segmented.module.css';

type Props<Value extends string> = {
  options: Array<{ value: Value; label: string }>;
  value: Value;
  onChange: (value: Value) => void;
  /** Names the group for assistive tech; omit it inside a labelled fieldset. */
  label?: string;
  /** Ids of the group's error and hint, read when a segment gets focus. */
  describedBy?: string;
};

/**
 * A segmented control for two or three short options (design language
 * components §4): joined segments, the selected one in the selected context.
 */
export default function Segmented<Value extends string>({
  options,
  value,
  onChange,
  label,
  describedBy,
}: Props<Value>) {
  return (
    <div
      className={styles.segmented}
      role={label ? 'group' : undefined}
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.button}
          aria-pressed={option.value === value}
          aria-describedby={describedBy}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
