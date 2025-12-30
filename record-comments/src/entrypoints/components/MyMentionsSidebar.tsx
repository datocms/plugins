import type { CommentWithContext } from '@hooks/useAllCommentsData';
import CommentSidebarSection from './shared/CommentSidebarSection';

type MyMentionsSidebarProps = {
  mentions: CommentWithContext[];
  isLoading: boolean;
  onNavigateToRecord: (modelId: string, recordId: string) => void;
  onScrollToGlobalComment?: (commentId: string) => void;
};

/** Sidebar section showing comments where the current user was mentioned. */
const MyMentionsSidebar = ({
  mentions,
  isLoading,
  onNavigateToRecord,
  onScrollToGlobalComment,
}: MyMentionsSidebarProps) => (
  <CommentSidebarSection
    title="My Mentions"
    emptyMessage="No mentions yet. When someone mentions you with @, it will appear here."
    items={mentions}
    isLoading={isLoading}
    onNavigateToRecord={onNavigateToRecord}
    onScrollToGlobalComment={onScrollToGlobalComment}
  />
);

export default MyMentionsSidebar;
