import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import CardList from 'datocms-react-ui/CardList';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import { useState } from 'react';
import { rawValueText } from '../../lib/fieldValue';
import styles from './FieldParts.module.css';

type Props = {
  /** A short title (`invalidValueTitle`). */
  title: string;
  /**
   * What's wrong, in plain words: `describeStoredValueError`, or a more
   * precise sentence such as the two shops of a shop mismatch.
   */
  message: string;
  /**
   * Add that the value is kept as saved. Off when the message already says
   * what to do (a value from a newer plugin version), so the callout stays
   * at two sentences.
   */
  keptNote?: boolean;
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

function keptSentence(readOnly: boolean, canPickAgain: boolean): string {
  if (readOnly) return "It's kept as it is.";
  return canPickAgain
    ? "It's kept as it is until you pick again or clear it."
    : "It's kept as it is until you clear it.";
}

const SAVED_VALUE = 'Saved value';

/**
 * A value this field can't read: a short title, the reason, the raw value
 * exactly as saved (with its copy button), and "Clear value" behind a
 * confirmation ("Pick again" too, for a value saved for another store).
 * Nothing changes until an editor acts. A value saved for another store only
 * needs picking again: its raw value is in a card that opens from its
 * header, closed at first. A damaged value shows it right away: the text is
 * all that's left to recover.
 */
export default function InvalidValue({
  title,
  message,
  keptNote = true,
  rawValue,
  readOnly,
  onClear,
  onPickAgain,
  picking = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const snippet = (
    <CodeSnippet
      ariaLabel={SAVED_VALUE}
      code={rawValueText(rawValue)}
      maxHeight={200}
    />
  );
  return (
    <>
      <Callout tone="danger" title={title} className={styles.calloutWithAction}>
        {keptNote
          ? `${message} ${keptSentence(readOnly, Boolean(onPickAgain))}`
          : message}
      </Callout>
      {onPickAgain ? (
        <CardList
          header={{
            title: SAVED_VALUE,
            collapse: { open, onToggle: () => setOpen((current) => !current) },
          }}
        >
          <CardList.Item body={snippet} />
        </CardList>
      ) : (
        snippet
      )}
      {!readOnly && (
        <div className={`${styles.actions} ${styles.afterValue}`}>
          {onPickAgain && (
            <Button label="Pick again" busy={picking} onClick={onPickAgain} />
          )}
          <Button
            tone="ghost-alert"
            label="Clear value"
            disabled={
              picking
                ? { reason: 'Wait until the new pick is saved.' }
                : undefined
            }
            onClick={onClear}
          />
        </div>
      )}
    </>
  );
}
