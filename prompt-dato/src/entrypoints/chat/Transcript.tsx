import BlankSlate from 'datocms-react-ui/BlankSlate';
import Callout from 'datocms-react-ui/Callout';
import EntityRow from 'datocms-react-ui/EntityRow';
import IconAvatar from 'datocms-react-ui/IconAvatar';
import Link from 'datocms-react-ui/Link';
import RowList from 'datocms-react-ui/RowList';
import Spinner from 'datocms-react-ui/Spinner';
import type { ProcessTrace } from '../../lib/processTrace';
import type { FieldInfo } from '../../lib/recordContext';
import type { SidebarConversationItem } from '../../lib/sidebarChatHistory';
import { ChatIcon } from '../icons';
import { ActivityTrace } from './ActivityTrace';
import { ApprovalCard } from './ApprovalCard';
import type { FieldNavigationTarget } from './fieldLinks';
import { ReplyMarkdown } from './ReplyMarkdown';
import { STARTERS } from './starters';
import s from './Transcript.module.css';

type MessageItem = Extract<SidebarConversationItem, { kind: 'message' }>;

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
  isSending: boolean;
  resolveApproval: (approvalRequestId: string, approve: boolean) => unknown;
  toggleApprovalDetails: (approvalRequestId: string) => void;
  /** The CMS path of the plugin settings */
  settingsPath: string;
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
}: Pick<Props, 'firstName' | 'onStarter'>) {
  return (
    <BlankSlate
      placement="inline"
      className={s.greeting}
      small
      icon={<ChatIcon />}
      title="No messages yet"
      description={`Hi ${firstName}, ask to rewrite, summarize or fill fields from what this record already has.`}
    >
      <div className={s.starters}>
        <RowList>
          {STARTERS.map((starter) => (
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
      </div>
    </BlankSlate>
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

  return (
    <div className={s.reply}>
      {item.process ? (
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
    </div>
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
  isSending,
  resolveApproval,
  toggleApprovalDetails,
  settingsPath,
}: Props) {
  if (showGreeting) {
    return <Greeting firstName={firstName} onStarter={onStarter} />;
  }

  // The code snippets of the chat are regions, which need names of their
  // own: the replies and the approvals of each action are numbered in order
  let replyCount = 0;
  const approvalCounts = new Map<string, number>();

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
          const ordinal = (approvalCounts.get(item.toolName) ?? 0) + 1;
          approvalCounts.set(item.toolName, ordinal);
          return (
            <ApprovalCard
              key={item.id}
              item={item}
              ordinal={ordinal}
              canDecide={supportsWriteApprovals}
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
            <Callout tone="danger" title="The request failed">
              <p className={s.errorMessage}>{item.message}</p>
              {item.reauth ? (
                <p>
                  <Link to={settingsPath}>
                    Reconnect in the plugin settings
                  </Link>
                </p>
              ) : null}
            </Callout>
          </div>
        );
      })}
    </div>
  );
}
