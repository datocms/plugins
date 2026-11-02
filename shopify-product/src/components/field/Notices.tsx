import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Link from 'datocms-react-ui/Link';
import type { ReactNode } from 'react';
import { ArrowsRotateIcon } from '../../icons';
import styles from './FieldParts.module.css';
import { BUSY_REASON } from './useEditorActions';

type NoticeProps = {
  tone: 'neutral' | 'warning' | 'danger';
  title?: string;
  /** The button that acts on it: right under the callout, never inside it. */
  action?: ReactNode;
  children: ReactNode;
};

/** A fact about the value, with the button that fixes it under it. */
function Notice({ tone, title, action, children }: NoticeProps) {
  return (
    <>
      <Callout
        tone={tone}
        title={title}
        className={action ? styles.calloutWithAction : undefined}
      >
        {children}
      </Callout>
      {action && <div className={styles.actions}>{action}</div>}
    </>
  );
}

/** The text of the link to the plugin settings, wherever it shows. */
export const SETTINGS_LINK_LABEL = 'Open the plugin settings';

type LoadErrorProps = {
  title: string;
  /**
   * What went wrong. With `settings`, it never sends to the settings itself:
   * the link to them follows it.
   */
  message: string;
  /** Loading again: "Try again" is busy. */
  retrying: boolean;
  /**
   * Only the plugin settings can fix it (the token, its permissions, the
   * store address) and the role can open them: the next step is a link to
   * them, in the text ("Open the plugin settings to update it.").
   */
  settings?: { path: string; step: string };
  /** Omitted when trying again can't help (a connection problem, for admins). */
  onRetry?: () => void;
};

/** Hydration failed: the cause in plain words, then the next step. */
export function LoadErrorNotice({
  title,
  message,
  retrying,
  settings,
  onRetry,
}: LoadErrorProps) {
  return (
    <Notice
      tone="danger"
      title={title}
      action={
        onRetry ? (
          <Button label="Try again" busy={retrying} onClick={onRetry} />
        ) : undefined
      }
    >
      {message}
      {settings && (
        <>
          {' '}
          <Link to={settings.path}>{SETTINGS_LINK_LABEL}</Link> {settings.step}.
        </>
      )}
    </Notice>
  );
}

type FormatMismatchProps = {
  message: string;
  /** Why converting can't happen now, or null. */
  problem: string | null;
  readOnly: boolean;
  /** Another action runs. */
  busy: boolean;
  /** Converting runs. */
  pending: boolean;
  onConvert: () => void;
};

/**
 * A valid value in another format than the field's settings: one sentence in
 * the editor's words, and Convert under it.
 */
export function FormatMismatchNotice({
  message,
  problem,
  readOnly,
  busy,
  pending,
  onConvert,
}: FormatMismatchProps) {
  const reason = problem ?? (busy && !pending ? BUSY_REASON : null);
  return (
    <Notice
      tone="neutral"
      action={
        readOnly ? undefined : (
          <Button
            label="Convert"
            busy={pending}
            disabled={reason ? { reason } : undefined}
            onClick={onConvert}
          />
        )
      }
    >
      {message}
    </Notice>
  );
}

type LegacyDriftProps = {
  summary: string;
  readOnly: boolean;
  busy: boolean;
  pending: boolean;
  onRefresh: () => void;
};

/**
 * A value saved as product JSON (the first version's format) whose saved
 * copy no longer matches Shopify. One sentence: no title.
 */
export function LegacyDriftNotice({
  summary,
  readOnly,
  busy,
  pending,
  onRefresh,
}: LegacyDriftProps) {
  return (
    <Notice
      tone="warning"
      action={
        readOnly ? undefined : (
          <Button
            label="Refresh saved data"
            icon={ArrowsRotateIcon}
            busy={pending}
            disabled={busy && !pending ? { reason: BUSY_REASON } : undefined}
            onClick={onRefresh}
          />
        )
      }
    >
      {summary}
    </Notice>
  );
}
