import type { CommentWithContext } from '@hooks/useAllCommentsData';
import type { UserInfo } from '@hooks/useMentions';
import CommentPreview from '../CommentPreview';
import styles from '@styles/dashboard.module.css';

type CommentSidebarSectionProps = {
  title: string;
  emptyMessage: string;
  items: CommentWithContext[];
  isLoading: boolean;
  headerActionLabel?: string;
  onHeaderAction?: () => void;
  isHeaderActionDisabled?: boolean;
  onNavigateToRecord: (modelId: string, recordId: string) => void;
  onScrollToGlobalComment?: (commentId: string) => void;
  onItemClick?: (item: CommentWithContext) => void;
  showMentionBadge?: boolean;
  projectUsers?: UserInfo[];
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
  headerActionLabel,
  onHeaderAction,
  isHeaderActionDisabled = false,
  onNavigateToRecord,
  onScrollToGlobalComment,
  onItemClick,
  showMentionBadge = false,
  projectUsers,
}: CommentSidebarSectionProps) => {
  const handleClick = (item: CommentWithContext) => {
    if (onItemClick) {
      onItemClick(item);
    }
    if (item.isGlobal) {
      // For global comments, scroll to it in the channel
      onScrollToGlobalComment?.(item.comment.id);
      return;
    }
    // For record comments, navigate to the record
    onNavigateToRecord(item.modelId, item.recordId);
  };

  return (
    <div className={styles.sidebarSection}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionHeaderRow}>
          <h3 className={styles.sectionTitle}>{title}</h3>
          {headerActionLabel && onHeaderAction && (
            <button
              type="button"
              className={styles.sectionActionButton}
              onClick={onHeaderAction}
              disabled={isHeaderActionDisabled}
            >
              {headerActionLabel}
            </button>
          )}
        </div>
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
              key={item.mentionKey ?? `${item.recordId}-${item.comment.id}`}
              commentWithContext={item}
              onClick={() => handleClick(item)}
              showMentionBadge={showMentionBadge}
              projectUsers={projectUsers}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default CommentSidebarSection;
