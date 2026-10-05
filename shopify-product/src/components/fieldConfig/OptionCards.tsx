import type { ReactNode } from 'react';
import type { ChoiceDescription } from './ChoiceFieldset';
import { describedBy } from './describe';
import styles from './OptionCards.module.css';

export type OptionCard<Value extends string> = {
  value: Value;
  label: ReactNode;
  description: ReactNode;
  /** A small badge after the label, e.g. "Recommended". */
  badge?: string;
  /** Disables the card and replaces its description with the reason. */
  disabledReason?: string;
};

type Props<Value extends string> = Partial<ChoiceDescription> & {
  /** Radio group name, also the prefix of every input ID. */
  name: string;
  options: OptionCard<Value>[];
  value: Value;
  onChange: (value: Value) => void;
};

/**
 * Radio cards (design language `.dl-option-card`): a few always-visible
 * options, each with a title and a one-line description. Native radios, so
 * arrow keys move between them.
 */
export default function OptionCards<Value extends string>({
  name,
  options,
  value,
  onChange,
  describedBy: groupDescription,
  invalid,
}: Props<Value>) {
  return (
    <div className={styles.cards}>
      {options.map((option) => (
        <Card
          key={option.value}
          name={name}
          option={option}
          checked={option.value === value}
          groupDescription={groupDescription}
          invalid={invalid}
          onSelect={onChange}
        />
      ))}
    </div>
  );
}

type CardProps<Value extends string> = {
  name: string;
  option: OptionCard<Value>;
  checked: boolean;
  /** The group's error and hint, read before the card's own description. */
  groupDescription: string | undefined;
  invalid: true | undefined;
  onSelect: (value: Value) => void;
};

function cardClassName(checked: boolean, disabled: boolean): string {
  return [styles.card, checked && styles.checked, disabled && styles.disabled]
    .filter(Boolean)
    .join(' ');
}

function Card<Value extends string>({
  name,
  option,
  checked,
  groupDescription,
  invalid,
  onSelect,
}: CardProps<Value>) {
  const id = `${name}-${option.value}`;
  const disabled = Boolean(option.disabledReason);
  return (
    <label className={cardClassName(checked, disabled)} htmlFor={id}>
      <span className={styles.radio}>
        <input
          type="radio"
          id={id}
          name={name}
          value={option.value}
          checked={checked}
          disabled={disabled}
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy(
            groupDescription,
            option.badge && `${id}-badge`,
            `${id}-description`,
          )}
          aria-invalid={invalid}
          onChange={() => onSelect(option.value)}
        />
      </span>
      <span className={styles.body}>
        <span className={styles.label}>
          <span id={`${id}-label`}>{option.label}</span>
          {option.badge && (
            <span className={styles.badge} id={`${id}-badge`}>
              {option.badge}
            </span>
          )}
        </span>
        <span className={styles.description} id={`${id}-description`}>
          {option.disabledReason ?? option.description}
        </span>
      </span>
    </label>
  );
}
