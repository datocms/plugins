import { useId, memo, useMemo } from 'react';
import type { Mention } from '@ctypes/mentions';
import type { UserInfo } from '@hooks/useMentions';
import {
  extractLeadingEmoji,
  getTruncatedFilename,
  formatFieldType,
} from '@utils/mentionFormatters';
import { areMentionsEqual } from '@utils/comparisonHelpers';
import { RecordDocumentIcon, ModelMentionIcon } from '../Icons';
import styles from '@styles/comment.module.css';

type MentionDisplayProps = {
  mention: Mention;
  onClick?: (e: React.MouseEvent) => void;
  /** When false, button is disabled and uses disabled styling (used for non-clickable field mentions) */
  isClickable?: boolean;
  /** Control tab focus behavior - set to -1 for composer context */
  tabIndex?: number;
  /** Optional tooltip ID for aria-describedby accessibility. If not provided, a unique ID is generated. */
  tooltipId?: string;
  /** Optional project users for resolving user mention name overrides */
  projectUsers?: UserInfo[];
};

/**
 * Shared component for rendering mention display across the application.
 * Used by both CommentContentRenderer (for displaying comments) and
 * MentionChip (for the composer and other contexts).
 *
 * Handles all 5 mention types: user, field, asset, record, model
 *
 * Memoized to prevent unnecessary re-renders when parent components update.
 * Uses custom comparison for the mention object since it's a complex type.
 */
const MentionDisplayComponent = ({
  mention,
  onClick,
  isClickable = true,
  tabIndex = 0,
  tooltipId: externalTooltipId,
  projectUsers,
}: MentionDisplayProps) => {
  // Generate a unique ID if none is provided, ensuring aria-describedby always has a valid reference
  const generatedId = useId();
  const tooltipId = externalTooltipId ?? `mention-tooltip-${generatedId}`;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(e);
  };

  // Resolve user mention name from projectUsers (which may have overrides applied)
  // Fall back to the name stored in the mention if no match found
  const resolvedUserName = useMemo(() => {
    if (mention.type !== 'user' || !projectUsers) {
      return mention.type === 'user' ? mention.name : '';
    }

    // Match by ID first (most reliable - works for all user types including organizations)
    let matchingUser = projectUsers.find((user) => user.id === mention.id);

    // Fall back to email match if ID doesn't match (for backward compatibility)
    if (!matchingUser && mention.email) {
      matchingUser = projectUsers.find(
        (user) => user.email && user.email === mention.email
      );
    }

    if (matchingUser) {
      return matchingUser.name;
    }

    // Fall back to original mention name
    return mention.name;
  }, [mention, projectUsers]);

  switch (mention.type) {
    case 'user':
      return (
        <span className={styles.userMentionWrapper}>
          <button
            type="button"
            tabIndex={tabIndex}
            className={styles.userMention}
            aria-describedby={tooltipId}
            onClick={handleClick}
          >
            @{resolvedUserName}
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className={styles.userMentionTooltip}
          >
            {mention.email || 'Organization'}
            <span className={styles.userMentionTooltipArrow} aria-hidden="true" />
          </span>
        </span>
      );

    case 'field': {
      const hasLocale = mention.localized && mention.locale;
      const formattedFieldType = formatFieldType(mention.fieldType);

      return (
        <span className={styles.fieldMentionWrapper}>
          <button
            type="button"
            tabIndex={tabIndex}
            className={`${styles.fieldMention}${!isClickable ? ` ${styles.fieldMentionDisabled}` : ''}`}
            aria-describedby={formattedFieldType ? tooltipId : undefined}
            onClick={isClickable ? handleClick : undefined}
            disabled={!isClickable}
          >
            #{mention.apiKey}
            {hasLocale && (
              <span className={styles.fieldMentionLocaleBadge}>
                {mention.locale}
              </span>
            )}
          </button>
          {formattedFieldType && (
            <span
              id={tooltipId}
              role="tooltip"
              className={styles.fieldMentionTooltip}
            >
              {formattedFieldType}
              <span className={styles.fieldMentionTooltipArrow} aria-hidden="true" />
            </span>
          )}
        </span>
      );
    }

    case 'asset': {
      const isVisualMedia = mention.mimeType.startsWith('image/') || mention.mimeType.startsWith('video/');
      const hasThumb = mention.thumbnailUrl && isVisualMedia;
      const truncatedName = getTruncatedFilename(mention.filename);

      // Block style for images and videos with thumbnails
      if (hasThumb) {
        return (
          <span className={styles.assetMentionBlockWrapper}>
            <button
              type="button"
              tabIndex={tabIndex}
              className={styles.assetMentionBlock}
              onClick={handleClick}
            >
              <img
                src={mention.thumbnailUrl!}
                alt={mention.filename}
                className={styles.assetMentionBlockThumb}
                onError={(e) => {
                  // Replace broken image with a fallback icon container.
                  // Uses data attribute on parent for CSS-based fallback visibility,
                  // which is more robust than DOM traversal (nextElementSibling).
                  const target = e.currentTarget;
                  target.onerror = null; // Prevent infinite loop
                  target.style.display = 'none';
                  // Set data attribute on parent button to trigger CSS fallback display
                  const parentButton = target.closest('button');
                  if (parentButton) {
                    parentButton.setAttribute('data-img-error', 'true');
                  }
                }}
              />
              <span className={styles.assetMentionBlockFallback} aria-hidden="true">
                ^
              </span>
              <span className={styles.assetMentionBlockName}>
                {mention.filename}
              </span>
            </button>
          </span>
        );
      }

      // Inline style for non-images
      return (
        <span className={styles.assetMentionWrapper}>
          <button
            type="button"
            tabIndex={tabIndex}
            className={`${styles.assetMention} ${styles.assetMentionNoThumb}`}
            aria-describedby={tooltipId}
            onClick={handleClick}
          >
            <span className={styles.assetMentionName}>{truncatedName}</span>
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className={styles.assetMentionTooltip}
          >
            {mention.filename}
            <span className={styles.assetMentionTooltipArrow} aria-hidden="true" />
          </span>
        </span>
      );
    }

    case 'record': {
      // For singletons, title is the model name which may include an emoji
      // Extract it to avoid showing the emoji twice
      const { emoji: titleEmoji, textWithoutEmoji: cleanTitle } = extractLeadingEmoji(mention.title);
      const displayEmoji = mention.thumbnailUrl ? null : (titleEmoji || mention.modelEmoji || (mention.isSingleton ? '📄' : null));
      const displayTitle = titleEmoji ? cleanTitle : mention.title;
      const tooltipText = mention.isSingleton ? 'Singleton' : mention.modelName;

      return (
        <span className={styles.recordMentionWrapper}>
          <button
            type="button"
            tabIndex={tabIndex}
            className={`${styles.recordMention} ${!mention.thumbnailUrl ? styles.recordMentionNoThumb : ''}`}
            aria-describedby={tooltipId}
            onClick={handleClick}
          >
            {mention.thumbnailUrl ? (
              <>
                <img
                  src={mention.thumbnailUrl}
                  alt={`Thumbnail for ${displayTitle}`}
                  className={styles.recordMentionThumb}
                  onError={(e) => {
                    // Replace broken image with fallback icon.
                    // Uses data attribute on parent for CSS-based fallback visibility,
                    // which is more robust than DOM traversal (nextElementSibling).
                    const target = e.currentTarget;
                    target.onerror = null; // Prevent infinite loop
                    target.style.display = 'none';
                    // Set data attribute on parent button to trigger CSS fallback display
                    const parentButton = target.closest('button');
                    if (parentButton) {
                      parentButton.setAttribute('data-img-error', 'true');
                    }
                  }}
                />
                <span className={styles.recordMentionFallback} aria-hidden="true">
                  <RecordDocumentIcon className={styles.recordMentionIcon} />
                </span>
              </>
            ) : displayEmoji ? (
              <span className={styles.recordMentionEmoji}>{displayEmoji}</span>
            ) : (
              <RecordDocumentIcon className={styles.recordMentionIcon} />
            )}
            <span className={styles.recordMentionTitle}>{displayTitle}</span>
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className={styles.recordMentionTooltip}
          >
            {tooltipText}
            <span className={styles.recordMentionTooltipArrow} aria-hidden="true" />
          </span>
        </span>
      );
    }

    case 'model': {
      const { emoji: modelEmoji, textWithoutEmoji: cleanName } = extractLeadingEmoji(mention.name);

      return (
        <span className={styles.modelMentionWrapper}>
          <button
            type="button"
            tabIndex={tabIndex}
            className={styles.modelMention}
            aria-describedby={tooltipId}
            onClick={handleClick}
          >
            {modelEmoji ? (
              <span className={styles.modelMentionEmoji}>{modelEmoji}</span>
            ) : (
              <ModelMentionIcon className={styles.modelMentionIcon} />
            )}
            {cleanName}
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className={styles.modelMentionTooltip}
          >
            {mention.isBlockModel ? 'Block' : 'Model'}: {mention.apiKey}
            <span className={styles.modelMentionTooltipArrow} aria-hidden="true" />
          </span>
        </span>
      );
    }

    default:
      return null;
  }
};

/**
 * Memoized MentionDisplay component.
 * Custom comparator checks mention equality and primitive props.
 */
export const MentionDisplay = memo(MentionDisplayComponent, (prevProps, nextProps) => {
  // Compare primitive props first (fast)
  if (prevProps.isClickable !== nextProps.isClickable) return false;
  if (prevProps.tabIndex !== nextProps.tabIndex) return false;
  if (prevProps.tooltipId !== nextProps.tooltipId) return false;

  // onClick is typically stable (useCallback) or undefined, reference equality is fine
  if (prevProps.onClick !== nextProps.onClick) return false;

  // projectUsers is memoized in useProjectData, so reference equality is fine
  if (prevProps.projectUsers !== nextProps.projectUsers) return false;

  // Deep compare the mention object
  return areMentionsEqual(prevProps.mention, nextProps.mention);
});

export default MentionDisplay;
