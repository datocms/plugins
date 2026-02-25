import { memo, useMemo } from 'react';
import ReactTimeAgo from 'react-time-ago';
import type { CommentWithContext } from '@hooks/useAllCommentsData';
import type { UserInfo } from '@hooks/useMentions';
import { getGravatarUrl } from '@/utils/helpers';
import { MentionBadgeIcon, GlobeIcon } from './Icons';
import styles from '@styles/dashboard.module.css';

type CommentPreviewProps = {
  commentWithContext: CommentWithContext;
  onClick: () => void;
  showMentionBadge?: boolean;
  projectUsers?: UserInfo[];
};

/** Extracts preview text from stored comment content. */
function getPreviewText(
  comment: CommentWithContext['comment'],
  maxLength = 80,
  userNames?: Map<string, string>
): string {
  const textParts: string[] = [];

  for (const segment of comment.content) {
    if (segment.type === 'text') {
      textParts.push(segment.content);
    } else if (segment.type === 'mention') {
      // StoredMention only has IDs - show type prefix as placeholder
      switch (segment.mention.type) {
        case 'user':
          textParts.push(`@${userNames?.get(segment.mention.id) ?? 'user'}`);
          break;
        case 'field':
          textParts.push(`#${segment.mention.fieldPath}`);
          break;
        case 'record':
          textParts.push(`[record]`);
          break;
        case 'asset':
          textParts.push(`[asset]`);
          break;
        case 'model':
          textParts.push(`$model`);
          break;
      }
    }
  }

  const fullText = textParts.join('').trim();
  if (fullText.length <= maxLength) {
    return fullText;
  }
  return `${fullText.slice(0, maxLength)}…`;
}

const CommentPreviewComponent = ({
  commentWithContext,
  onClick,
  showMentionBadge = false,
  projectUsers,
}: CommentPreviewProps) => {
  const { comment, isGlobal, isReply } = commentWithContext;
  const resolvedAuthor = projectUsers?.find((user) => user.id === comment.authorId);
  const authorDisplayName = resolvedAuthor?.name ?? `User ${comment.authorId.slice(0, 8)}`;
  const authorEmail = resolvedAuthor?.email ?? '';
  const fallbackAvatarUrl = authorEmail
    ? getGravatarUrl(authorEmail, 64)
    : getGravatarUrl('', 64);
  const avatarUrl = resolvedAuthor?.avatarUrl ?? fallbackAvatarUrl;
  const userNames = useMemo(() => {
    const map = new Map<string, string>();
    projectUsers?.forEach((user) => map.set(user.id, user.name));
    return map;
  }, [projectUsers]);

  const previewText = getPreviewText(comment, 80, userNames);

  return (
    <button
      type="button"
      className={styles.commentPreview}
      onClick={onClick}
    >
      <img
        src={avatarUrl}
        alt={authorDisplayName}
        className={styles.previewAvatar}
        onError={(e) => {
          const target = e.currentTarget;
          target.onerror = null; // Prevent infinite loop
          target.src = fallbackAvatarUrl;
        }}
      />
      <div className={styles.previewContent}>
        <div className={styles.previewHeader}>
          <span className={styles.previewAuthor}>{authorDisplayName}</span>
          <span className={styles.previewTime}>
            <ReactTimeAgo date={new Date(comment.dateISO)} />
          </span>
          {showMentionBadge && (
            <span className={styles.previewMentionBadge}>
              <MentionBadgeIcon aria-label="Mentioned you" />
            </span>
          )}
        </div>
        <div className={styles.previewText}>{previewText}</div>
        {!isGlobal && (
          <div className={styles.previewContext}>
            <span className={styles.previewContextText}>
              {isReply ? 'Reply in ' : 'In '}
              {commentWithContext.isSingleton
                ? (commentWithContext.recordTitle ?? `Record #${commentWithContext.recordId}`)
                : `${commentWithContext.modelName ?? 'Record'} "${commentWithContext.recordTitle ?? commentWithContext.recordId}"`}
            </span>
          </div>
        )}
        {isGlobal && (
          <div className={styles.previewContext}>
            <GlobeIcon className={styles.previewContextIcon} aria-label="Project discussion" />
            <span className={styles.previewContextText}>
              {isReply ? 'Reply in project discussion' : 'Project discussion'}
            </span>
          </div>
        )}
      </div>
    </button>
  );
};

const CommentPreview = memo(CommentPreviewComponent, (prevProps, nextProps) => {
  if (prevProps.commentWithContext.comment.id !== nextProps.commentWithContext.comment.id) {
    return false;
  }
  if (prevProps.showMentionBadge !== nextProps.showMentionBadge) {
    return false;
  }
  if (prevProps.onClick !== nextProps.onClick) {
    return false;
  }
  if (prevProps.projectUsers !== nextProps.projectUsers) {
    return false;
  }
  return true;
});

export default CommentPreview;
