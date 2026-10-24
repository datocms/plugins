import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import EntityRow from 'datocms-react-ui/EntityRow';
import Pane from 'datocms-react-ui/Pane';
import RowList from 'datocms-react-ui/RowList';
import SmartDate from 'datocms-react-ui/SmartDate';
import Toolbar from 'datocms-react-ui/Toolbar';
import {
  getSidebarThreadPreview,
  type SidebarChatThread,
} from '../../lib/sidebarChatHistory';
import { useFormatters } from '../../utils/format';
import { AddIcon, ChatIcon } from '../icons';

const WAIT_FOR_REPLY = { reason: 'Wait for the reply to finish.' };

type Props = {
  /** The chats about this record, the last updated first */
  threads: SidebarChatThread[];
  isSending: boolean;
  onNewChat: () => void;
  onOpenThread: (threadId: string) => void;
  onDeleteAll: () => unknown;
};

/** The date of the last change of a chat, or nothing when it has none */
function updatedAt(thread: SidebarChatThread): Date | null {
  return Number.isFinite(thread.updatedAt) && thread.updatedAt > 0
    ? new Date(thread.updatedAt)
    : null;
}

/**
 * The chats about the record, saved in this browser. A row opens its chat;
 * the chat itself holds its own delete. With no chats, the blank slate holds
 * the action that starts the first one, and the bar shows only its title.
 */
export function ChatList({
  threads,
  isSending,
  onNewChat,
  onOpenThread,
  onDeleteAll,
}: Props) {
  const { chats } = useFormatters();
  const hasChats = threads.length > 0;

  return (
    <Pane
      ariaLabel="Chats"
      header={
        <Pane.Header>
          <Pane.Header.Title>Chats</Pane.Header.Title>
          {hasChats && (
            <Pane.Header.Subtitle>{chats(threads.length)}</Pane.Header.Subtitle>
          )}
          {hasChats && (
            <Pane.Header.Menu>
              <Dropdown.Option
                alert
                disabled={isSending ? WAIT_FOR_REPLY : undefined}
                onPick={() => {
                  void onDeleteAll();
                }}
              >
                Delete all chats
              </Dropdown.Option>
            </Pane.Header.Menu>
          )}
          {hasChats && (
            <Pane.Header.Button>
              {/* The list shows only between replies: the button has no reason
                  to give while one is sending */}
              <Toolbar.PrimaryButton
                actions={[
                  { label: 'New chat', icon: AddIcon, onPick: onNewChat },
                ]}
                disabled={isSending}
              />
            </Pane.Header.Button>
          )}
        </Pane.Header>
      }
    >
      {hasChats ? (
        <RowList>
          {threads.map((thread) => (
            <RowList.Item
              key={thread.id}
              onClick={() => onOpenThread(thread.id)}
            >
              <EntityRow
                layout="row"
                title={thread.title}
                aside={<SmartDate value={updatedAt(thread)} />}
              >
                {getSidebarThreadPreview(thread)}
              </EntityRow>
            </RowList.Item>
          ))}
        </RowList>
      ) : (
        <BlankSlate
          placement="area"
          small
          icon={<ChatIcon />}
          title="No chats yet"
          description="Chats about this record are saved in this browser."
          actions={
            <Button
              tone="primary"
              icon={AddIcon}
              label="New chat"
              onClick={onNewChat}
            />
          }
        />
      )}
    </Pane>
  );
}
