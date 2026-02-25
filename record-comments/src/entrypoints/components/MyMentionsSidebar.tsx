import type { CommentWithContext } from '@hooks/useAllCommentsData';
import type { UserInfo } from '@hooks/useMentions';
import CommentSidebarSection from './shared/CommentSidebarSection';

type MyMentionsSidebarProps = {
  mentions: CommentWithContext[];
  isLoading: boolean;
  unreadCount: number;
  onMarkAllAsRead: () => void;
  onNavigateToRecord: (modelId: string, recordId: string) => void;
  onScrollToGlobalComment?: (commentId: string) => void;
  onItemClick?: (item: CommentWithContext) => void;
  projectUsers?: UserInfo[];
};

/** Sidebar section showing comments where the current user was mentioned. */
const MyMentionsSidebar = ({
  mentions,
  isLoading,
  unreadCount,
  onMarkAllAsRead,
  onNavigateToRecord,
  onScrollToGlobalComment,
  onItemClick,
  projectUsers,
}: MyMentionsSidebarProps) => (
  <CommentSidebarSection
    title="My Mentions"
    emptyMessage="No mentions yet. When someone mentions you with /user, it will appear here."
    items={mentions}
    isLoading={isLoading}
    headerActionLabel="Mark all as read"
    onHeaderAction={onMarkAllAsRead}
    isHeaderActionDisabled={isLoading || unreadCount === 0}
    onNavigateToRecord={onNavigateToRecord}
    onScrollToGlobalComment={onScrollToGlobalComment}
    onItemClick={onItemClick}
    showMentionBadge
    projectUsers={projectUsers}
  />
);

export default MyMentionsSidebar;
