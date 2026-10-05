import { faCopy } from '@fortawesome/free-regular-svg-icons';
import { FieldHint } from 'datocms-react-ui';
import { useEffect, useState } from 'react';
import { truncateMiddle } from '../../lib/format';
import { buildExampleStoredValue } from '../../lib/references';
import type { FieldParametersV1, FieldType } from '../../types';
import { Icon } from '../../ui/Icon';
import Tip from '../shared/Tip';
import { exampleHint } from './copy';
import styles from './StoredValueExample.module.css';

type Props = {
  fieldType: FieldType;
  params: FieldParametersV1;
  /** The field's store; the example's `shop` uses it. */
  shopDomain?: string;
};

/**
 * 7. The value a field with these settings stores, built with the same
 * serializers the editor uses. The copy button copies it exactly; the block
 * shows JSON indented, with long URLs shortened in the middle so every key
 * stays on one line. One plain-text <pre>: every element counts for the
 * auto-resizer.
 */
export default function StoredValueExample({
  fieldType,
  params,
  shopDomain,
}: Props) {
  const value = buildExampleStoredValue(fieldType, params, shopDomain);
  return (
    <figure className={styles.example}>
      <figcaption className={styles.caption}>Stored value example</figcaption>
      <div className={styles.block}>
        <pre className={styles.code}>
          {readable(fieldType, value) || 'No example for these settings'}
        </pre>
        {value && <CopyButton text={value} />}
      </div>
      <FieldHint>{exampleHint(params)}</FieldHint>
    </figure>
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

type CopyState = 'idle' | 'copied' | 'failed';

const TOOLTIP: Record<CopyState, string> = {
  idle: 'Copy to clipboard',
  copied: 'Copied!',
  failed: "Couldn't copy to the clipboard",
};

const ANNOUNCEMENT: Record<CopyState, string> = {
  idle: '',
  copied: 'Stored value example copied',
  failed: "Couldn't copy the stored value example",
};

/** For iframes without the Clipboard API permission. */
function copyWithSelection(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyWithSelection(text);
  }
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timeout = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(timeout);
  }, [state]);

  return (
    <>
      <Tip tip={TOOLTIP[state]} placement="left">
        <button
          type="button"
          className={`dl-icon-button ${styles.copy}`}
          aria-label="Copy to clipboard"
          onClick={async () => {
            setState((await copyText(text)) ? 'copied' : 'failed');
          }}
        >
          <Icon icon={faCopy} />
        </button>
      </Tip>
      <span className="dl-sr-only" role="status">
        {ANNOUNCEMENT[state]}
      </span>
    </>
  );
}
