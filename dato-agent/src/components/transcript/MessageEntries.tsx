import Callout from 'datocms-react-ui/Callout';
import type { AgentMentionHost } from '../../lib/mentionHost';
import type { CommentSegment, Mention } from '../../lib/mentions';
import { MentionDisplay } from '../../recordComments/entrypoints/components/shared/MentionDisplay';
import type { AgentMessageEntry, AgentSurfaceProps } from '../AgentSurface';
import { Markdown } from '../Markdown';
import { FailureActions } from './FailureActions';
import { mentionIdentity, withStableKeys } from './keys';
import styles from './Transcript.module.css';

/** The error of a message, as text: `true` means the stream stopped early */
export function messageError(entry: AgentMessageEntry) {
  if (typeof entry.error === 'string') return entry.error.trim() || undefined;
  return entry.error ? 'The response was interrupted.' : undefined;
}

/** The text of a user message, with its references as pills in the line */
function UserMessageContent({
  content,
  currentRecordId,
  mentionHost,
  disabled,
  onOpenMention,
  segments,
}: {
  content: string;
  currentRecordId?: string;
  mentionHost: AgentMentionHost;
  disabled: boolean;
  onOpenMention: (mention: Mention) => void;
  segments?: readonly CommentSegment[];
}) {
  // A div, not a p: the card of a visual asset is a block
  if (!segments?.length) {
    return <div className={styles.bubble}>{content}</div>;
  }

  return (
    <div className={styles.bubble}>
      {withStableKeys(segments, (segment) =>
        segment.type === 'text'
          ? `text:${segment.content.slice(0, 64)}`
          : mentionIdentity(segment.mention),
      ).map(({ key, value: segment }) => {
        if (segment.type === 'text') {
          return <span key={key}>{segment.content}</span>;
        }

        const isProjectOwner =
          segment.mention.type === 'user' &&
          segment.mention.id === mentionHost.projectOwnerId;

        return (
          <MentionDisplay
            currentRecordId={currentRecordId}
            isClickable={!disabled && !isProjectOwner}
            isProjectOwner={isProjectOwner}
            key={key}
            mention={segment.mention}
            onClick={() => onOpenMention(segment.mention)}
            projectUsers={[mentionHost.currentUser]}
          />
        );
      })}
    </div>
  );
}

/**
 * A message of the agent: the Markdown of the response, a quiet "Stopped"
 * when the user stopped it, and the error with its recovery actions. A
 * partial response stays visible above its error.
 */
export function AssistantMessageContent({
  entry,
  onRetryFailedTurn,
  onCopyFailureDiagnostics,
  suppressInterruptedNotice = false,
}: {
  entry: AgentMessageEntry;
  onRetryFailedTurn?: AgentSurfaceProps['onRetryFailedTurn'];
  onCopyFailureDiagnostics?: AgentSurfaceProps['onCopyFailureDiagnostics'];
  /** The activity of the turn already says "Stopped" */
  suppressInterruptedNotice?: boolean;
}) {
  const errorMessage = messageError(entry);
  const stoppedOnly =
    entry.interrupted && !errorMessage && entry.content.trim() === 'Stopped.';
  const showInterruptedNotice =
    entry.interrupted && !errorMessage && !suppressInterruptedNotice;
  const showContent = Boolean(entry.content) && !stoppedOnly;

  if (!showContent && !errorMessage && !showInterruptedNotice) return null;

  return (
    <div className={styles.message}>
      {showContent && <Markdown content={entry.content} />}
      {showInterruptedNotice && (
        <p className={styles.stopped} role="status">
          Stopped
        </p>
      )}
      {errorMessage && (
        <Callout className={styles.callout} tone="danger">
          {errorMessage}
        </Callout>
      )}
      {errorMessage && entry.failure && (
        <FailureActions
          failure={entry.failure}
          onCopyDiagnostics={onCopyFailureDiagnostics}
          onRetry={onRetryFailedTurn}
        />
      )}
    </div>
  );
}

/**
 * A message of the user: its own article, a bubble at the right, and the
 * error under it. It has no visible name, date or avatar.
 */
export function UserMessageEntry({
  currentRecordId,
  disabled,
  entry,
  mentionHost,
  onOpenMention,
}: {
  disabled: boolean;
  currentRecordId?: string;
  entry: AgentMessageEntry;
  mentionHost: AgentMentionHost;
  onOpenMention: (mention: Mention) => void;
}) {
  const errorMessage = messageError(entry);

  if (!entry.content && !errorMessage) {
    return null;
  }

  return (
    <article aria-label={entry.label ?? 'You'} className={styles.userTurn}>
      {entry.content && (
        <UserMessageContent
          content={entry.content}
          currentRecordId={currentRecordId}
          disabled={disabled}
          mentionHost={mentionHost}
          onOpenMention={onOpenMention}
          segments={entry.segments}
        />
      )}
      {errorMessage && (
        <Callout className={styles.callout} tone="danger">
          {errorMessage}
        </Callout>
      )}
    </article>
  );
}
