import { Spinner } from 'datocms-react-ui';
import { useId, useState } from 'react';
import { previewText, rawValueText } from '../../lib/fieldValue';
import { Button } from '../../ui/Button';
import Callout from '../shared/Callout';
import styles from './FieldParts.module.css';

type Props = {
  /** A short title (`invalidValueTitle`). */
  title: string;
  /** What's wrong, in plain words (`describeStoredValueError`). */
  message: string;
  /** An extra sentence, such as the two shops of a shop mismatch. */
  detail?: string | null;
  rawValue: unknown;
  readOnly: boolean;
  onClear: () => void;
  /**
   * For a value saved for another store: pick from this field's store,
   * replacing the old value.
   */
  onPickAgain?: () => void;
  /** The picker is open or its pick is being saved. */
  picking?: boolean;
};

type ActionsProps = Pick<
  Props,
  'readOnly' | 'onClear' | 'onPickAgain' | 'picking'
>;

function RawValue({
  value,
  readOnly,
  onClear,
  onPickAgain,
  picking = false,
}: ActionsProps & { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const text = rawValueText(value);
  const preview = previewText(text);
  return (
    <>
      <pre id={id} className={styles.raw} aria-label="Saved value">
        {expanded ? text : preview.text}
      </pre>
      {(!readOnly || preview.truncated) && (
        <div className={styles.calloutActions}>
          {!readOnly && onPickAgain && (
            <Button
              buttonSize="xxs"
              onClick={picking ? undefined : onPickAgain}
            >
              Pick again
              {picking && <Spinner size={16} />}
            </Button>
          )}
          {!readOnly && (
            <Button buttonSize="xxs" disabled={picking} onClick={onClear}>
              Clear value
            </Button>
          )}
          {preview.truncated && (
            <button
              type="button"
              className={styles.linkButton}
              aria-expanded={expanded}
              aria-controls={id}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? 'Show less' : 'Show full value'}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function keptSentence(readOnly: boolean, canPickAgain: boolean): string {
  if (readOnly) return "It's kept exactly as saved.";
  return canPickAgain
    ? "It's kept exactly as saved until you pick again or clear it."
    : "It's kept exactly as saved until you clear it.";
}

/**
 * A value this field can't read: a short title, the reason, the raw value
 * exactly as saved, and "Clear value" behind a confirmation ("Pick again"
 * too, for a value saved for another store). Nothing changes until an
 * editor acts.
 */
export default function InvalidValue({
  title,
  message,
  detail,
  rawValue,
  readOnly,
  onClear,
  onPickAgain,
  picking,
}: Props) {
  return (
    <Callout tone="danger" role="alert" title={title}>
      <p className={styles.calloutText}>
        {[message, detail, keptSentence(readOnly, Boolean(onPickAgain))]
          .filter(Boolean)
          .join(' ')}
      </p>
      <RawValue
        value={rawValue}
        readOnly={readOnly}
        onClear={onClear}
        onPickAgain={onPickAgain}
        picking={picking}
      />
    </Callout>
  );
}
