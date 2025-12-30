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
  isClickable?: boolean;
  isProjectOwner?: boolean;
  tabIndex?: number;
  tooltipId?: string;
  projectUsers?: UserInfo[];
};

const MentionDisplayComponent = ({
  mention,
  onClick,
  isClickable = true,
  isProjectOwner = false,
  tabIndex = 0,
  tooltipId: externalTooltipId,
  projectUsers,
}: MentionDisplayProps) => {
  const generatedId = useId();
  const tooltipId = externalTooltipId ?? `mention-tooltip-${generatedId}`;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(e);
  };

  const resolvedUserName = useMemo(() => {
    if (mention.type !== 'user' || !projectUsers) {
      return mention.type === 'user' ? mention.name : '';
    }

    let matchingUser = projectUsers.find((user) => user.id === mention.id);

    if (!matchingUser && mention.email) {
      matchingUser = projectUsers.find(
        (user) => user.email && user.email === mention.email
      );
    }

    if (matchingUser) {
      return matchingUser.name;
    }

    return mention.name;
  }, [mention, projectUsers]);

  switch (mention.type) {
    case 'user': {
      const tooltipText = isProjectOwner
        ? 'Project Owner'
        : mention.email || 'Organization';

      return (
        <span className={styles.userMentionWrapper}>
          <button
            type="button"
            tabIndex={tabIndex}
            className={`${styles.userMention}${!isClickable ? ` ${styles.userMentionDisabled}` : ''}`}
            aria-describedby={tooltipId}
            onClick={isClickable ? handleClick : undefined}
            disabled={!isClickable}
          >
            @{resolvedUserName}
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className={styles.userMentionTooltip}
          >
            {tooltipText}
            <span className={styles.userMentionTooltipArrow} aria-hidden="true" />
          </span>
        </span>
      );
    }

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
                  const target = e.currentTarget;
                  target.onerror = null;
                  target.style.display = 'none';
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
                    const target = e.currentTarget;
                    target.onerror = null;
                    target.style.display = 'none';
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

export const MentionDisplay = memo(MentionDisplayComponent, (prevProps, nextProps) => {
  if (prevProps.isClickable !== nextProps.isClickable) return false;
  if (prevProps.isProjectOwner !== nextProps.isProjectOwner) return false;
  if (prevProps.tabIndex !== nextProps.tabIndex) return false;
  if (prevProps.tooltipId !== nextProps.tooltipId) return false;
  if (prevProps.onClick !== nextProps.onClick) return false;
  if (prevProps.projectUsers !== nextProps.projectUsers) return false;

  return areMentionsEqual(prevProps.mention, nextProps.mention);
});

export default MentionDisplay;
