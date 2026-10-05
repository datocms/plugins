import { FieldError, FieldHint } from 'datocms-react-ui';
import type { ReactNode } from 'react';
import styles from './ChoiceFieldset.module.css';
import { describe } from './describe';

/** What each choice in the group points at: the group's error and hint. */
export type ChoiceDescription = {
  describedBy: string | undefined;
  invalid: true | undefined;
};

type Props = {
  /** Prefix of the error and hint ids (`<id>-error`, `<id>-hint`). */
  id: string;
  legend: ReactNode;
  error?: string;
  hint?: ReactNode;
  /** The choices, given the ids they must be described by. */
  children: (description: ChoiceDescription) => ReactNode;
};

/**
 * Field anatomy (label → control → error → hint) for a group of choices: a
 * fieldset whose legend looks like the kit's form label. The legend names the
 * group; each choice is described by the error and hint, so screen readers
 * announce them when it gets focus.
 */
export default function ChoiceFieldset({
  id,
  legend,
  error,
  hint,
  children,
}: Props) {
  const described = describe(id, hint, error);
  return (
    <fieldset className={styles.fieldset}>
      <legend
        className={
          error ? `${styles.legend} ${styles.legendError}` : styles.legend
        }
      >
        {legend}
      </legend>
      {children({ describedBy: described.ids, invalid: described.invalid })}
      {described.error && <FieldError>{described.error}</FieldError>}
      {described.hint && <FieldHint>{described.hint}</FieldHint>}
    </fieldset>
  );
}
