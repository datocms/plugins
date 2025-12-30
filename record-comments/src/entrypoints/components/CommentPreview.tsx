import { memo } from 'react';
import ReactTimeAgo from 'react-time-ago';
import type { CommentWithContext } from '@hooks/useAllCommentsData';
import { getGravatarUrl } from '@/utils/helpers';
import { MentionBadgeIcon, GlobeIcon } from './Icons';
import styles from '@styles/dashboard.module.css';

type CommentPreviewProps = {
  commentWithContext: CommentWithContext;
  onClick: () => void;
  showMentionBadge?: boolean;
};

function getPreviewText(comment: CommentWithContext['comment'], maxLength = 80): string {
  const textParts: string[] = [];

  for (const segment of comment.content) {
    if (segment.type === 'text') {
      textParts.push(segment.content);
    } else if (segment.type === 'mention') {
      switch (segment.mention.type) {
        case 'user':
          textParts.push(`@${segment.mention.name}`);
          break;
        case 'field':
          textParts.push(`#${segment.mention.apiKey}`);
          break;
        case 'record':
          textParts.push(segment.mention.title);
          break;
        case 'asset':
          textParts.push(segment.mention.filename);
          break;
        case 'model':
          textParts.push(`$${segment.mention.name}`);
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
}: CommentPreviewProps) => {
  const { comment, isGlobal, isReply } = commentWithContext;
  const avatarUrl = getGravatarUrl(comment.author.email, 64);
  const previewText = getPreviewText(comment);

  return (
    <button
      type="button"
      className={styles.commentPreview}
      onClick={onClick}
    >
      <img
        src={avatarUrl}
        alt={comment.author.name}
        className={styles.previewAvatar}
        onError={(e) => {
          const target = e.currentTarget;
          target.onerror = null; // Prevent infinite loop
          target.src = getGravatarUrl(comment.author.email, 64);
        }}
      />
      <div className={styles.previewContent}>
        <div className={styles.previewHeader}>
          <span className={styles.previewAuthor}>{comment.author.name}</span>
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
  return true;
});

export default CommentPreview;
