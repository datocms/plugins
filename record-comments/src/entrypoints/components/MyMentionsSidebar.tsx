import type { CommentWithContext } from '@hooks/useAllCommentsData';
import CommentSidebarSection from './shared/CommentSidebarSection';

type MyMentionsSidebarProps = {
  mentions: CommentWithContext[];
  isLoading: boolean;
  onNavigateToRecord: (modelId: string, recordId: string) => void;
  onScrollToGlobalComment?: (commentId: string) => void;
};

/**
 * Sidebar section showing comments where the current user was mentioned.
 * Clicking a comment navigates to the record where it was made.
 *
 * ARCHITECTURE NOTE: THIN WRAPPER INTENTIONALLY NOT CONSOLIDATED
 *
 * This component and RecentCommentsList are both thin wrappers around
 * CommentSidebarSection. While they could be replaced with a factory function
 * or parameterized component, they are intentionally kept as separate components:
 *
 * 1. SEMANTIC CLARITY: Named components communicate intent better than
 *    <CommentSidebarSection title="My Mentions" ... /> at call sites
 * 2. FUTURE EXTENSIBILITY: If mention-specific behavior is needed later,
 *    this wrapper is the natural place to add it
 * 3. MINIMAL OVERHEAD: 15 lines per wrapper is negligible code cost
 * 4. IMPORT ORGANIZATION: Consumers import semantically named components
 *    rather than needing to know about CommentSidebarSection
 *
 * The pattern of thin semantic wrappers over generic base components is
 * common in well-structured React codebases. Consolidation would reduce
 * lines of code but would harm readability and maintainability.
 */
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
