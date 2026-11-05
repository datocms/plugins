import BlankSlate from 'datocms-react-ui/BlankSlate';
import Callout from 'datocms-react-ui/Callout';
import EntityRow from 'datocms-react-ui/EntityRow';
import IconAvatar from 'datocms-react-ui/IconAvatar';
import Link from 'datocms-react-ui/Link';
import RowList from 'datocms-react-ui/RowList';
import Spinner from 'datocms-react-ui/Spinner';
import type { ProcessTrace } from '../../lib/processTrace';
import type { FieldInfo } from '../../lib/recordContext';
import {
  INTERRUPTED_TURN_MESSAGE,
  LEGACY_INTERRUPTED_REQUEST_MESSAGE,
  LEGACY_INTERRUPTED_TURN_MESSAGE,
  type SidebarConversationItem,
} from '../../lib/sidebarChatHistory';
import { ChatIcon } from '../icons';
import { ActivityTrace, hasActivityLine } from './ActivityTrace';
import { ApprovalCard } from './ApprovalCard';
import type { FieldNavigationTarget } from './fieldLinks';
import { InlineCode } from './InlineCode';
import { ReplyMarkdown } from './ReplyMarkdown';
import { STARTERS } from './starters';
import s from './Transcript.module.css';

type MessageItem = Extract<SidebarConversationItem, { kind: 'message' }>;
type ErrorItem = Extract<SidebarConversationItem, { kind: 'error' }>;

type Props = {
  conversation: SidebarConversationItem[];
  /** The chat is empty: show the greeting and the starters */
  showGreeting: boolean;
  firstName: string;
  /** Puts the prompt of a starter in the composer, without sending it */
  onStarter: (prompt: string) => void;
  /** The fields of the model, to resolve the `field:` links of the replies */
  fields: FieldInfo[];
  locales: string[];
  /** The CMS path of the form of the record, for the `field:` links */
  recordEditPath: string | null;
  onScrollToField: (target: FieldNavigationTarget) => void;
  isActivityOpen: (messageId: string, trace?: ProcessTrace) => boolean;
  toggleActivity: (messageId: string, trace?: ProcessTrace) => void;
  /** The provider can submit approval decisions */
  supportsWriteApprovals: boolean;
  /** The name of the provider of the settings: "OpenAI" */
  providerLabel: string;
  isSending: boolean;
  resolveApproval: (approvalRequestId: string, approve: boolean) => unknown;
  toggleApprovalDetails: (approvalRequestId: string) => void;
  /** The CMS path of the plugin settings, or null when the user can't open them */
  settingsPath: string | null;
};

/**
 * The empty chat. The blank slate is the only content of the log, which
 * scrolls: it is in the flow, at least as tall as the log, thus it stays in
 * the center when it fits and scrolls from its top when the frame is short.
 * An area blank slate is centered with auto margins, which push a taller
 * slate above the top of the log, out of reach of the scroll.
 */
function Greeting({
  firstName,
  onStarter,
  supportsWriteApprovals,
}: Pick<Props, 'firstName' | 'onStarter' | 'supportsWriteApprovals'>) {
  // A provider that can only read offers no starter that changes the record
  const starters = supportsWriteApprovals
    ? STARTERS
    : STARTERS.filter((starter) => !starter.changesRecord);

  return (
    <BlankSlate
      placement="inline"
      className={s.greeting}
      small
      icon={<ChatIcon />}
      title="No messages yet"
      description={
        supportsWriteApprovals
          ? `Hi ${firstName}, you can ask to rewrite, summarize or fill in the fields of this record.`
          : `Hi ${firstName}, you can ask to rewrite, summarize or check this record. This chat suggests changes but can't make them.`
      }
    >
      {/* The blank slate gives the inset: the text of the rows stays on its
          edge */}
      <RowList density="compact">
        {starters.map((starter) => (
          <RowList.Item
            key={starter.title}
            onClick={() => onStarter(starter.prompt)}
          >
            <EntityRow
              layout="row"
              image={
                <IconAvatar icon={starter.icon} size={32} surface="muted" />
              }
              title={starter.title}
            >
              {starter.hint}
            </EntityRow>
          </RowList.Item>
        ))}
      </RowList>
    </BlankSlate>
  );
}

/** A turn that a reload stopped: its change may be in the record already */
function ReloadWarning() {
  return (
    <Callout tone="warning" title="The page reloaded before the reply finished">
      The change may already be in the record: check it before you send the
      request again.
    </Callout>
  );
}

function Reply({
  item,
  replyNumber,
  fields,
  locales,
  recordEditPath,
  onScrollToField,
  isActivityOpen,
  toggleActivity,
}: { item: MessageItem; replyNumber: number } & Pick<
  Props,
  | 'fields'
  | 'locales'
  | 'recordEditPath'
  | 'onScrollToField'
  | 'isActivityOpen'
  | 'toggleActivity'
>) {
  const showText = item.text.trim().length > 0 || item.process === undefined;
  const showActivity = item.process ? hasActivityLine(item.process) : false;
  // A reload cut the reply after some text: the text alone looks finished.
  // A reply without text has the same words as its text already.
  const showReloadWarning =
    item.process?.status === 'interrupted' &&
    item.text !== INTERRUPTED_TURN_MESSAGE &&
    item.text !== LEGACY_INTERRUPTED_TURN_MESSAGE;

  // A turn that stopped before its first step and wrote nothing: the error
  // or the card after it tells it alone
  if (!showText && !showActivity) return null;

  return (
    <div className={s.reply}>
      {showActivity ? (
        <ActivityTrace
          trace={item.process}
          open={isActivityOpen(item.id, item.process)}
          onToggle={() => toggleActivity(item.id, item.process)}
        />
      ) : null}
      {showText ? (
        <ReplyMarkdown
          text={item.text}
          replyNumber={replyNumber}
          fields={fields}
          locales={locales}
          recordEditPath={recordEditPath}
          onScrollToField={onScrollToField}
        />
      ) : null}
      {showReloadWarning ? <ReloadWarning /> : null}
    </div>
  );
}

/**
 * The provider refused the request because its account has no quota left.
 * A limit that says when to retry passes soon: the fallback shows its words.
 */
function isQuotaError(message: string): boolean {
  return /quota|billing/i.test(message) && !/retry|try again/i.test(message);
}

/**
 * A turn that failed: what happened and what to do, in plain words. The
 * message of the provider or of the server is a quiet detail, only for the
 * errors that have no words of their own.
 */
function TurnError({
  item,
  settingsPath,
  providerLabel,
}: { item: ErrorItem } & Pick<Props, 'settingsPath' | 'providerLabel'>) {
  if (
    item.message === INTERRUPTED_TURN_MESSAGE ||
    item.message === LEGACY_INTERRUPTED_REQUEST_MESSAGE
  ) {
    return <ReloadWarning />;
  }

  if (item.reauth) {
    return (
      <Callout tone="danger" title="The DatoCMS connection expired">
        {settingsPath ? (
          <>
            <Link to={settingsPath}>Reconnect in the plugin settings</Link>.
          </>
        ) : (
          'Ask an administrator to reconnect it in the plugin settings.'
        )}
      </Callout>
    );
  }

  if (isQuotaError(item.message)) {
    return (
      <Callout
        tone="danger"
        title={`${providerLabel}'s usage limit is reached`}
      >
        Ask an administrator to check the plan and billing of the{' '}
        {providerLabel} account.
      </Callout>
    );
  }

  return (
    <Callout tone="danger" title="The chat couldn't answer">
      <p>Send your message again in a moment.</p>
      <p className={s.errorMessage}>
        <InlineCode>{item.message.replace(/^\d{3}\s+/, '')}</InlineCode>
      </p>
    </Callout>
  );
}

/**
 * The entries of a chat, in order: the user's messages, the replies with
 * their activity, the actions that wait for approval and the errors. An
 * empty chat shows the greeting and the starters instead.
 */
export function Transcript({
  conversation,
  showGreeting,
  firstName,
  onStarter,
  fields,
  locales,
  recordEditPath,
  onScrollToField,
  isActivityOpen,
  toggleActivity,
  supportsWriteApprovals,
  providerLabel,
  isSending,
  resolveApproval,
  toggleApprovalDetails,
  settingsPath,
}: Props) {
  if (showGreeting) {
    return (
      <Greeting
        firstName={firstName}
        onStarter={onStarter}
        supportsWriteApprovals={supportsWriteApprovals}
      />
    );
  }

  // The code snippets of the chat are regions, which need names of their
  // own: the replies and the approvals are numbered in order
  let replyCount = 0;
  let approvalCount = 0;

  return (
    <div className={s.entries}>
      {conversation.map((item) => {
        if (item.kind === 'message') {
          if (item.role === 'user') {
            return (
              <div key={item.id} className={s.user}>
                {/* The side of the bubble tells who wrote it: the log tells
                    it in words too */}
                <div className={s.bubble}>
                  <span className="visually-hidden">You: </span>
                  {item.text}
                </div>
              </div>
            );
          }

          replyCount += 1;
          return (
            <Reply
              key={item.id}
              item={item}
              replyNumber={replyCount}
              fields={fields}
              locales={locales}
              recordEditPath={recordEditPath}
              onScrollToField={onScrollToField}
              isActivityOpen={isActivityOpen}
              toggleActivity={toggleActivity}
            />
          );
        }

        if (item.kind === 'pending') {
          return (
            <div key={item.id} className={s.pending} role="status">
              <Spinner inline label={false} />
              <span>Preparing the reply</span>
            </div>
          );
        }

        if (item.kind === 'approval') {
          approvalCount += 1;
          return (
            <ApprovalCard
              key={item.id}
              item={item}
              ordinal={approvalCount}
              canDecide={supportsWriteApprovals}
              providerLabel={providerLabel}
              busyElsewhere={isSending && item.state !== 'submitting'}
              onApprove={() => resolveApproval(item.approvalRequestId, true)}
              onDeny={() => resolveApproval(item.approvalRequestId, false)}
              onToggleDetails={() =>
                toggleApprovalDetails(item.approvalRequestId)
              }
            />
          );
        }

        return (
          <div key={item.id}>
            <TurnError
              item={item}
              settingsPath={settingsPath}
              providerLabel={providerLabel}
            />
          </div>
        );
      })}
    </div>
  );
}
