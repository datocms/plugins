import type { CommentWithContext } from '@hooks/useAllCommentsData';
import type { UserInfo } from '@hooks/useMentions';
import CommentSidebarSection from './shared/CommentSidebarSection';

type RecentCommentsListProps = {
  comments: CommentWithContext[];
  isLoading: boolean;
  onNavigateToRecord: (modelId: string, recordId: string) => void;
  onScrollToGlobalComment?: (commentId: string) => void;
  projectUsers?: UserInfo[];
};

/**
 * Sidebar section showing the most recent comments across all records.
 * Clicking a comment navigates to the record where it was made.
 */
const RecentCommentsList = ({
  comments,
  isLoading,
  onNavigateToRecord,
  onScrollToGlobalComment,
  projectUsers,
}: RecentCommentsListProps) => (
  <CommentSidebarSection
    title="Recent Comments"
    emptyMessage="No comments yet. Start a discussion to see recent activity."
    items={comments}
    isLoading={isLoading}
    onNavigateToRecord={onNavigateToRecord}
    onScrollToGlobalComment={onScrollToGlobalComment}
    projectUsers={projectUsers}
  />
);

export default RecentCommentsList;
