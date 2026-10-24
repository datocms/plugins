import BlankSlate from 'datocms-react-ui/BlankSlate';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import CopyableValue from 'datocms-react-ui/CopyableValue';
import FieldHint from 'datocms-react-ui/FieldHint';
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
 * JSON field stores a document: a code box that shows it indented, with long
 * URLs shortened in the middle so every key stays on one line.
 */
export default function StoredValueExample({
  fieldType,
  params,
  shopDomain,
}: Props) {
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
  const shown = readable(fieldType, value);
  return (
    <div>
      <p className={styles.caption}>{LABEL}</p>
      {value ? (
        <CodeSnippet ariaLabel={LABEL} code={value}>
          {shown === value ? undefined : (
            <pre className={styles.readable}>{shown}</pre>
          )}
        </CodeSnippet>
      ) : (
        <BlankSlate
          placement="section"
          small
          title="No example for these settings"
        />
      )}
      <FieldHint hint={exampleHint(params)} />
    </div>
  );
}

/** Long URLs (images) are shortened in the middle; other strings stay exact. */
const MAX_SHOWN_URL = 44;
const URL_PATTERN = /^https?:\/\//;

function shortened(_key: string, value: unknown): unknown {
  return typeof value === 'string' && URL_PATTERN.test(value)
    ? truncateMiddle(value, MAX_SHOWN_URL)
    : value;
}

/** JSON values are indented for reading, long URLs shortened; plain strings as they are. */
function readable(fieldType: FieldType, value: string): string {
  if (fieldType !== 'json' || !value) return value;
  try {
    return JSON.stringify(JSON.parse(value), shortened, 2);
  } catch {
    return value;
  }
}
