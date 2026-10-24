import BlankSlate from 'datocms-react-ui/BlankSlate';
import { useEffect, useRef } from 'react';
import { ChatIcon } from '../../icons';
import type { AgentMentionHost } from '../../lib/mentionHost';
import type { Mention } from '../../lib/mentions';
import type {
  AgentMessageEntry,
  AgentSurfaceProps,
  AgentTranscriptEntry,
} from '../AgentSurface';
import { ActivityEntry } from './ActivityEntry';
import { ApprovalEntry } from './ApprovalEntries';
import {
  AssistantMessageContent,
  messageError,
  UserMessageEntry,
} from './MessageEntries';
import {
  AssetsEntry,
  FieldsEntry,
  MentionsEntry,
  RecordsEntry,
} from './ReceiptEntries';
import styles from './Transcript.module.css';

/** The reader follows new content only this close to the bottom, in pixels */
const FOLLOW_THRESHOLD = 80;

type TranscriptGroup =
  | { kind: 'user'; id: string; entry: AgentMessageEntry }
  | { kind: 'agent'; id: string; entries: AgentTranscriptEntry[] };

/**
 * Each user message is a group of its own; everything after it, until the
 * next user message, is one turn of the agent.
 */
function groupTranscriptEntries(
  entries: readonly AgentTranscriptEntry[],
): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];

  for (const entry of entries) {
    if (entry.kind === 'message' && entry.role === 'user') {
      groups.push({ kind: 'user', id: `user:${entry.id}`, entry });
      continue;
    }

    const previous = groups.at(-1);
    if (previous?.kind === 'agent') {
      previous.entries.push(entry);
    } else {
      groups.push({
        kind: 'agent',
        id: `agent:${entry.id}`,
        entries: [entry],
      });
    }
  }

  return groups;
}

function agentEntryIsVisible(entry: AgentTranscriptEntry): boolean {
  switch (entry.kind) {
    case 'message':
      return (
        entry.role === 'assistant' &&
        Boolean(entry.content || messageError(entry) || entry.interrupted)
      );
    case 'activity':
      return entry.phase === 'running' || entry.activities.length > 0;
    case 'approval':
      return (
        !entry.approval.automatic ||
        Boolean(entry.approval.error || entry.approval.outcome)
      );
    case 'records':
      return Boolean(entry.title || entry.error || entry.records.length > 0);
    case 'fields':
      return Boolean(entry.title || entry.error || entry.fields.length > 0);
    case 'assets':
      return Boolean(entry.title || entry.error || entry.assets.length > 0);
    case 'mentions':
      return Boolean(entry.title || entry.error || entry.mentions.length > 0);
  }
}

function findLatestUserEntryId(
  entries: readonly AgentTranscriptEntry[],
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === 'message' && entry.role === 'user') {
      return entry.id;
    }
  }

  return undefined;
}

type TranscriptMentionActions = Pick<
  AgentSurfaceProps,
  'onOpenRecord' | 'onOpenField' | 'onOpenAsset'
> & { mentionHost: AgentMentionHost };

function ignoreHostActionFailure(result: void | Promise<void>) {
  void Promise.resolve(result).catch(() => undefined);
}

/** Opens a reference of a user message: each kind opens where it lives */
function openTranscriptMention(
  mention: Mention,
  actions: TranscriptMentionActions,
) {
  switch (mention.type) {
    case 'record':
      if (!actions.onOpenRecord) return;
      ignoreHostActionFailure(
        actions.onOpenRecord({
          itemId: mention.id,
          itemTypeId: mention.modelId,
          title: mention.title,
        }),
      );
      return;
    case 'field':
      if (!actions.onOpenField) return;
      ignoreHostActionFailure(
        actions.onOpenField({
          fieldPath: mention.fieldPath,
          title: mention.label,
          ...(mention.locale ? { locale: mention.locale } : {}),
        }),
      );
      return;
    case 'asset':
      if (!actions.onOpenAsset) return;
      ignoreHostActionFailure(
        actions.onOpenAsset({ uploadId: mention.id, title: mention.filename }),
      );
      return;
    case 'file':
      ignoreHostActionFailure(actions.mentionHost.openLocalFile(mention));
      return;
    case 'model':
      actions.mentionHost.openModel(mention.id, mention.isBlockModel);
      return;
    case 'user':
      ignoreHostActionFailure(actions.mentionHost.openUser(mention.id));
  }
}

type AgentTurnProps = Pick<
  AgentSurfaceProps,
  | 'currentRecordId'
  | 'hostActionPending'
  | 'onApproveUnsafeAction'
  | 'onCopyFailureDiagnostics'
  | 'onOpenAsset'
  | 'onOpenField'
  | 'onOpenRecord'
  | 'onRejectUnsafeAction'
  | 'onRepairUnsafeAction'
  | 'onRetryFailedTurn'
  | 'onReviewUnsafeAction'
> & {
  entries: readonly AgentTranscriptEntry[];
  autoApproveEnabled: boolean;
  mentionHost: AgentMentionHost;
};

/**
 * One turn of the agent, as one article: its activity, what it returned,
 * the changes it asks for and its response, in their order.
 */
function AgentTurnEntry({
  autoApproveEnabled,
  currentRecordId,
  entries,
  hostActionPending = false,
  mentionHost,
  onApproveUnsafeAction,
  onCopyFailureDiagnostics,
  onOpenAsset,
  onOpenField,
  onOpenRecord,
  onRejectUnsafeAction,
  onRepairUnsafeAction,
  onRetryFailedTurn,
  onReviewUnsafeAction,
}: AgentTurnProps) {
  const visibleEntries = entries.filter(agentEntryIsVisible);
  if (visibleEntries.length === 0) return null;

  const label =
    visibleEntries.find(
      (entry): entry is AgentMessageEntry => entry.kind === 'message',
    )?.label ?? 'Dato Agent';
  const hasCancelledActivity = visibleEntries.some(
    (entry) => entry.kind === 'activity' && entry.phase === 'cancelled',
  );

  return (
    <article aria-label={label} className={styles.agentTurn}>
      {visibleEntries.map((entry) => {
        switch (entry.kind) {
          case 'message':
            return (
              <AssistantMessageContent
                entry={entry}
                key={entry.id}
                onCopyFailureDiagnostics={onCopyFailureDiagnostics}
                onRetryFailedTurn={onRetryFailedTurn}
                suppressInterruptedNotice={hasCancelledActivity}
              />
            );
          case 'activity':
            return <ActivityEntry entry={entry} key={entry.id} />;
          case 'records':
            return (
              <RecordsEntry
                currentRecordId={currentRecordId}
                entry={entry}
                key={entry.id}
                locked={hostActionPending || Boolean(entry.opening)}
                mentionHost={mentionHost}
                onOpenRecord={onOpenRecord}
              />
            );
          case 'fields':
            return (
              <FieldsEntry
                entry={entry}
                key={entry.id}
                locked={hostActionPending}
                onOpenField={onOpenField}
              />
            );
          case 'assets':
            return (
              <AssetsEntry
                entry={entry}
                key={entry.id}
                locked={hostActionPending}
                onOpenAsset={onOpenAsset}
              />
            );
          case 'mentions':
            return (
              <MentionsEntry
                currentRecordId={currentRecordId}
                entry={entry}
                key={entry.id}
                locked={hostActionPending}
                mentionHost={mentionHost}
              />
            );
          case 'approval':
            return (
              <ApprovalEntry
                approval={entry.approval}
                autoApproveEnabled={autoApproveEnabled}
                key={entry.id}
                locked={hostActionPending}
                onApprove={onApproveUnsafeAction}
                onReject={onRejectUnsafeAction}
                onRepair={onRepairUnsafeAction}
                onReview={onReviewUnsafeAction}
              />
            );
          default:
            return null;
        }
      })}
    </article>
  );
}

export type TranscriptProps = Pick<
  AgentSurfaceProps,
  | 'entries'
  | 'autoApproveEnabled'
  | 'currentRecordId'
  | 'onOpenRecord'
  | 'onOpenField'
  | 'onOpenAsset'
  | 'onReviewUnsafeAction'
  | 'onApproveUnsafeAction'
  | 'onRejectUnsafeAction'
  | 'onRepairUnsafeAction'
  | 'onRetryFailedTurn'
  | 'onCopyFailureDiagnostics'
  | 'isRunning'
  | 'hostActionPending'
> & { mentionHost: AgentMentionHost };

/**
 * The conversation: a log that fills its positioned parent (the content of
 * the pane) and scrolls by itself. It follows new content while the reader
 * is near the bottom, and always shows a message that the user just sent.
 */
export function Transcript({
  autoApproveEnabled,
  currentRecordId,
  entries,
  mentionHost,
  onOpenRecord,
  onOpenField,
  onOpenAsset,
  onReviewUnsafeAction,
  onApproveUnsafeAction,
  onRejectUnsafeAction,
  onRepairUnsafeAction,
  onRetryFailedTurn,
  onCopyFailureDiagnostics,
  isRunning,
  hostActionPending,
}: TranscriptProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const latestUserEntryId = findLatestUserEntryId(entries);
  const previousLatestUserEntryIdRef = useRef(latestUserEntryId);

  useEffect(() => {
    void entries;
    void isRunning;
    const hasNewUserTurn =
      latestUserEntryId !== undefined &&
      latestUserEntryId !== previousLatestUserEntryIdRef.current;
    previousLatestUserEntryIdRef.current = latestUserEntryId;

    if (hasNewUserTurn) {
      shouldAutoScrollRef.current = true;
    }

    if (shouldAutoScrollRef.current) {
      endRef.current?.scrollIntoView?.({ block: 'end' });
    }
  }, [entries, isRunning, latestUserEntryId]);

  const openMention = (mention: Mention) => {
    if (hostActionPending) return;
    openTranscriptMention(mention, {
      mentionHost,
      onOpenAsset,
      onOpenField,
      onOpenRecord,
    });
  };

  return (
    <div
      aria-busy={isRunning}
      aria-live="polite"
      aria-relevant="additions text"
      className={styles.log}
      onScroll={() => {
        const log = logRef.current;

        if (!log) {
          return;
        }

        shouldAutoScrollRef.current =
          log.scrollHeight - log.scrollTop - log.clientHeight <=
          FOLLOW_THRESHOLD;
      }}
      ref={logRef}
      role="log"
    >
      {entries.length === 0 ? (
        // The title says what is missing, the description how it gets
        // there, with no keyboard instructions
        <BlankSlate
          description="Ask the agent to find, create or update content."
          icon={<ChatIcon />}
          placement="area"
          small
          title="No messages yet"
        />
      ) : (
        <div className={styles.turns}>
          {groupTranscriptEntries(entries).map((group) =>
            group.kind === 'user' ? (
              <UserMessageEntry
                currentRecordId={currentRecordId}
                disabled={Boolean(hostActionPending)}
                entry={group.entry}
                key={group.id}
                mentionHost={mentionHost}
                onOpenMention={openMention}
              />
            ) : (
              <AgentTurnEntry
                autoApproveEnabled={Boolean(autoApproveEnabled)}
                currentRecordId={currentRecordId}
                entries={group.entries}
                hostActionPending={hostActionPending}
                key={group.id}
                mentionHost={mentionHost}
                onApproveUnsafeAction={onApproveUnsafeAction}
                onCopyFailureDiagnostics={onCopyFailureDiagnostics}
                onOpenAsset={onOpenAsset}
                onOpenField={onOpenField}
                onOpenRecord={onOpenRecord}
                onRejectUnsafeAction={onRejectUnsafeAction}
                onRepairUnsafeAction={onRepairUnsafeAction}
                onRetryFailedTurn={onRetryFailedTurn}
                onReviewUnsafeAction={onReviewUnsafeAction}
              />
            ),
          )}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
