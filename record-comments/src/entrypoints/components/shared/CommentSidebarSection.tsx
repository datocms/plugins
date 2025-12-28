import type { CommentWithContext } from '@hooks/useAllCommentsData';
import CommentPreview from '../CommentPreview';
import styles from '@styles/dashboard.module.css';

type CommentSidebarSectionProps = {
  title: string;
  emptyMessage: string;
  items: CommentWithContext[];
  isLoading: boolean;
  onNavigateToRecord: (modelId: string, recordId: string) => void;
  onScrollToGlobalComment?: (commentId: string) => void;
};

/**
 * Shared sidebar section component for displaying comment lists.
 * Used by MyMentionsSidebar and RecentCommentsList to avoid code duplication.
 */
const CommentSidebarSection = ({
  title,
  emptyMessage,
  items,
  isLoading,
  onNavigateToRecord,
  onScrollToGlobalComment,
}: CommentSidebarSectionProps) => {
  const handleClick = (item: CommentWithContext) => {
    if (item.isGlobal && onScrollToGlobalComment) {
      // For global comments, scroll to it in the channel
      onScrollToGlobalComment(item.comment.id);
    } else {
      // For record comments, navigate to the record
      onNavigateToRecord(item.modelId, item.recordId);
    }
  };

  return (
    <div className={styles.sidebarSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{title}</h3>
      </div>
      <div className={styles.sectionContent}>
        {isLoading ? (
          <div className={styles.loading}>
            <div className={styles.loadingSpinner} />
          </div>
        ) : items.length === 0 ? (
          <div className={styles.emptySmall}>
            {emptyMessage}
          </div>
        ) : (
          items.map((item) => (
            <CommentPreview
              key={`${item.recordId}-${item.comment.id}`}
              commentWithContext={item}
              onClick={() => handleClick(item)}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default CommentSidebarSection;
