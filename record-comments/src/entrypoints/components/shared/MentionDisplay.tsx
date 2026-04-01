import type { Mention } from '@ctypes/mentions';
import type { UserInfo } from '@hooks/useMentions';
import styles from '@styles/comment.module.css';
import { areMentionsEqual } from '@utils/comparisonHelpers';
import { extractLeadingEmoji } from '@utils/emojiUtils';
import {
  formatFieldType,
  getTruncatedFilename,
} from '@utils/mentionFormatters';
import { memo, useId, useMemo, useState } from 'react';
import { cn } from '@/utils/cn';
import { ModelMentionIcon, RecordDocumentIcon } from '../Icons';

type MentionDisplayProps = {
  mention: Mention;
  onClick?: (e: React.MouseEvent) => void;
  isClickable?: boolean;
  isProjectOwner?: boolean;
  tabIndex?: number;
  tooltipId?: string;
  projectUsers?: UserInfo[];
};

type AssetThumbnailMentionProps = {
  mention: Extract<Mention, { type: 'asset' }>;
  tabIndex: number;
  onClick: (e: React.MouseEvent) => void;
  tooltipId: string;
};

function AssetThumbnailMention({
  mention,
  tabIndex,
  onClick,
  tooltipId,
}: AssetThumbnailMentionProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const truncatedName = getTruncatedFilename(mention.filename);

  // On error, fall back to simple filename display (same as non-visual assets)
  if (hasError) {
    return (
      <span className={styles.assetMentionWrapper}>
        <button
          type="button"
          tabIndex={tabIndex}
          className={cn(styles.assetMention, styles.assetMentionNoThumb)}
          aria-describedby={tooltipId}
          onClick={onClick}
        >
          <span className={styles.assetMentionName}>{truncatedName}</span>
        </button>
        <span
          id={tooltipId}
          role="tooltip"
          className={styles.assetMentionTooltip}
        >
          {mention.filename}
          <span
            className={styles.assetMentionTooltipArrow}
            aria-hidden="true"
          />
        </span>
      </span>
    );
  }

  return (
    <span className={styles.assetMentionBlockWrapper}>
      <button
        type="button"
        tabIndex={tabIndex}
        className={styles.assetMentionBlock}
        onClick={onClick}
      >
        {isLoading && (
          <span
            className={styles.assetMentionBlockSkeleton}
            aria-hidden="true"
          />
        )}
        <img
          src={mention.thumbnailUrl ?? ''}
          alt={mention.filename}
          className={cn(
            styles.assetMentionBlockThumb,
            isLoading && styles.assetMentionBlockThumbHidden,
          )}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
        />
        <span className={styles.assetMentionBlockName}>{mention.filename}</span>
      </button>
    </span>
  );
}

type UserMentionDisplayProps = {
  mention: Extract<Mention, { type: 'user' }>;
  isClickable: boolean;
  isProjectOwner: boolean;
  tabIndex: number;
  tooltipId: string;
  resolvedName: string;
  onClick: (e: React.MouseEvent) => void;
};

function UserMentionDisplay({
  mention,
  isClickable,
  isProjectOwner,
  tabIndex,
  tooltipId,
  resolvedName,
  onClick,
}: UserMentionDisplayProps) {
  const tooltipText = isProjectOwner
    ? 'Project Owner'
    : mention.email || 'Organization';

  return (
    <span className={styles.userMentionWrapper}>
      <button
        type="button"
        tabIndex={tabIndex}
        className={cn(
          styles.userMention,
          !isClickable && styles.userMentionDisabled,
        )}
        aria-describedby={tooltipId}
        onClick={isClickable ? onClick : undefined}
        disabled={!isClickable}
      >
        @{resolvedName}
      </button>
      <span id={tooltipId} role="tooltip" className={styles.userMentionTooltip}>
        {tooltipText}
        <span className={styles.userMentionTooltipArrow} aria-hidden="true" />
      </span>
    </span>
  );
}

type FieldMentionDisplayProps = {
  mention: Extract<Mention, { type: 'field' }>;
  isClickable: boolean;
  tabIndex: number;
  tooltipId: string;
  onClick: (e: React.MouseEvent) => void;
};

function FieldMentionDisplay({
  mention,
  isClickable,
  tabIndex,
  tooltipId,
  onClick,
}: FieldMentionDisplayProps) {
  const hasLocale = mention.localized && mention.locale;
  const formattedFieldType = formatFieldType(mention.fieldType);

  return (
    <span className={styles.fieldMentionWrapper}>
      <button
        type="button"
        tabIndex={tabIndex}
        className={cn(
          styles.fieldMention,
          !isClickable && styles.fieldMentionDisabled,
        )}
        aria-describedby={formattedFieldType ? tooltipId : undefined}
        onClick={isClickable ? onClick : undefined}
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
          <span
            className={styles.fieldMentionTooltipArrow}
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  );
}

type AssetMentionDisplayProps = {
  mention: Extract<Mention, { type: 'asset' }>;
  tabIndex: number;
  tooltipId: string;
  onClick: (e: React.MouseEvent) => void;
};

function AssetMentionDisplay({
  mention,
  tabIndex,
  tooltipId,
  onClick,
}: AssetMentionDisplayProps) {
  const isVisualMedia =
    mention.mimeType.startsWith('image/') ||
    mention.mimeType.startsWith('video/');
  const hasThumb = mention.thumbnailUrl && isVisualMedia;
  const truncatedName = getTruncatedFilename(mention.filename);

  if (hasThumb) {
    return (
      <AssetThumbnailMention
        mention={mention}
        tabIndex={tabIndex}
        onClick={onClick}
        tooltipId={tooltipId}
      />
    );
  }

  return (
    <span className={styles.assetMentionWrapper}>
      <button
        type="button"
        tabIndex={tabIndex}
        className={cn(styles.assetMention, styles.assetMentionNoThumb)}
        aria-describedby={tooltipId}
        onClick={onClick}
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

type RecordMentionDisplayProps = {
  mention: Extract<Mention, { type: 'record' }>;
  tabIndex: number;
  tooltipId: string;
  onClick: (e: React.MouseEvent) => void;
};

function RecordMentionDisplay({
  mention,
  tabIndex,
  tooltipId,
  onClick,
}: RecordMentionDisplayProps) {
  const { emoji: titleEmoji, textWithoutEmoji: cleanTitle } =
    extractLeadingEmoji(mention.title);
  const displayEmoji = mention.thumbnailUrl
    ? null
    : titleEmoji || mention.modelEmoji || (mention.isSingleton ? '📄' : null);
  const displayTitle = titleEmoji ? cleanTitle : mention.title;
  const tooltipText = mention.isSingleton ? 'Singleton' : mention.modelName;

  return (
    <span className={styles.recordMentionWrapper}>
      <button
        type="button"
        tabIndex={tabIndex}
        className={cn(
          styles.recordMention,
          !mention.thumbnailUrl && styles.recordMentionNoThumb,
        )}
        aria-describedby={tooltipId}
        onClick={onClick}
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

type ModelMentionDisplayProps = {
  mention: Extract<Mention, { type: 'model' }>;
  tabIndex: number;
  tooltipId: string;
  onClick: (e: React.MouseEvent) => void;
};

function ModelMentionDisplay({
  mention,
  tabIndex,
  tooltipId,
  onClick,
}: ModelMentionDisplayProps) {
  const { emoji: modelEmoji, textWithoutEmoji: cleanName } =
    extractLeadingEmoji(mention.name);

  return (
    <span className={styles.modelMentionWrapper}>
      <button
        type="button"
        tabIndex={tabIndex}
        className={styles.modelMention}
        aria-describedby={tooltipId}
        onClick={onClick}
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
        (user) => user.email && user.email === mention.email,
      );
    }

    if (matchingUser) {
      return matchingUser.name;
    }

    return mention.name;
  }, [mention, projectUsers]);

  switch (mention.type) {
    case 'user':
      return (
        <UserMentionDisplay
          mention={mention}
          isClickable={isClickable}
          isProjectOwner={isProjectOwner}
          tabIndex={tabIndex}
          tooltipId={tooltipId}
          resolvedName={resolvedUserName}
          onClick={handleClick}
        />
      );

    case 'field':
      return (
        <FieldMentionDisplay
          mention={mention}
          isClickable={isClickable}
          tabIndex={tabIndex}
          tooltipId={tooltipId}
          onClick={handleClick}
        />
      );

    case 'asset':
      return (
        <AssetMentionDisplay
          mention={mention}
          tabIndex={tabIndex}
          tooltipId={tooltipId}
          onClick={handleClick}
        />
      );

    case 'record':
      return (
        <RecordMentionDisplay
          mention={mention}
          tabIndex={tabIndex}
          tooltipId={tooltipId}
          onClick={handleClick}
        />
      );

    case 'model':
      return (
        <ModelMentionDisplay
          mention={mention}
          tabIndex={tabIndex}
          tooltipId={tooltipId}
          onClick={handleClick}
        />
      );

    default:
      return null;
  }
};

export const MentionDisplay = memo(
  MentionDisplayComponent,
  (prevProps, nextProps) => {
    if (prevProps.isClickable !== nextProps.isClickable) return false;
    if (prevProps.isProjectOwner !== nextProps.isProjectOwner) return false;
    if (prevProps.tabIndex !== nextProps.tabIndex) return false;
    if (prevProps.tooltipId !== nextProps.tooltipId) return false;
    if (prevProps.onClick !== nextProps.onClick) return false;
    if (prevProps.projectUsers !== nextProps.projectUsers) return false;

    return areMentionsEqual(prevProps.mention, nextProps.mention);
  },
);
