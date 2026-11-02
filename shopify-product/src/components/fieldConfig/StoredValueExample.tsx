import BlankSlate from 'datocms-react-ui/BlankSlate';
import CardList from 'datocms-react-ui/CardList';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import CopyableValue from 'datocms-react-ui/CopyableValue';
import FieldHint from 'datocms-react-ui/FieldHint';
import { useState } from 'react';
import { truncateMiddle } from '../../lib/format';
import { buildExampleStoredValue } from '../../lib/references';
import type { FieldParametersV1, FieldType } from '../../types';
import { exampleHint } from './copy';
import styles from './FieldSettings.module.css';

type Props = {
  fieldType: FieldType;
  params: FieldParametersV1;
  /** The field's store; the example's `shop` uses it. */
  shopDomain?: string;
};

const LABEL = 'Stored value example';

/**
 * 7. The value a field with these settings stores, built with the same
 * serializers the editor uses, and copied exactly. A string field stores a
 * short value (a handle, an ID): a read-only field with its copy button. A
 * JSON field stores a document: a code box, in a card that opens from its
 * header, closed at first. A reference document is
 * saved indented: the box shows it as saved, and scrolls past 200px. The
 * product JSON of the first version is saved on one line: the box shows it
 * indented, with long URLs shortened in the middle so every key stays on one
 * line, and at its full height (the plugin frame counts the height of every
 * element, so the hidden lines of a scrolling view would leave a gap under
 * the field).
 */
export default function StoredValueExample({
  fieldType,
  params,
  shopDomain,
}: Props) {
  const [open, setOpen] = useState(false);
  const value = buildExampleStoredValue(fieldType, params, shopDomain);
  if (fieldType === 'string' && value) {
    return (
      <CopyableValue
        label={LABEL}
        hint={exampleHint(params)}
        value={value}
        code
      />
    );
  }
  const view = params.format === 'legacyProductJson' ? readable(value) : null;
  return (
    <CardList
      header={{
        title: LABEL,
        collapse: { open, onToggle: () => setOpen((current) => !current) },
      }}
    >
      <CardList.Item
        body={
          <>
            {value ? (
              <CodeSnippet
                ariaLabel={LABEL}
                code={value}
                maxHeight={view ? undefined : MAX_HEIGHT}
              >
                {view ? (
                  <pre className={styles.readable}>{view}</pre>
                ) : undefined}
              </CodeSnippet>
            ) : (
              <BlankSlate
                placement="section"
                small
                title="No example for these settings"
              />
            )}
            <FieldHint hint={exampleHint(params)} />
          </>
        }
      />
    </CardList>
  );
}

/** The box of a long reference document scrolls past this height. */
const MAX_HEIGHT = 200;

/** Long URLs (images) are shortened in the middle; other strings stay exact. */
const MAX_SHOWN_URL = 44;
const URL_PATTERN = /^https?:\/\//;

function shortened(_key: string, value: unknown): unknown {
  return typeof value === 'string' && URL_PATTERN.test(value)
    ? truncateMiddle(value, MAX_SHOWN_URL)
    : value;
}

/** The product JSON indented for reading, long URLs shortened; null if it isn't JSON. */
function readable(value: string): string | null {
  if (!value) return null;
  try {
    return JSON.stringify(JSON.parse(value), shortened, 2);
  } catch {
    return null;
  }
}
