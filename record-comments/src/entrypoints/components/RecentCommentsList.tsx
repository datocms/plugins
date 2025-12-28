import type { CommentWithContext } from '@hooks/useAllCommentsData';
import CommentSidebarSection from './shared/CommentSidebarSection';

type RecentCommentsListProps = {
  comments: CommentWithContext[];
  isLoading: boolean;
  onNavigateToRecord: (modelId: string, recordId: string) => void;
  onScrollToGlobalComment?: (commentId: string) => void;
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
}: RecentCommentsListProps) => (
  <CommentSidebarSection
    title="Recent Comments"
    emptyMessage="No comments yet. Start a discussion to see recent activity."
    items={comments}
    isLoading={isLoading}
    onNavigateToRecord={onNavigateToRecord}
    onScrollToGlobalComment={onScrollToGlobalComment}
  />
);

export default RecentCommentsList;
