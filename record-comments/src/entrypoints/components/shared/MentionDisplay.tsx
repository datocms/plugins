import type { Mention } from '@ctypes/mentions';
import type { UserInfo } from '@hooks/useMentions';
import { areMentionsEqual } from '@utils/comparisonHelpers';
import { extractLeadingEmoji } from '@utils/emojiUtils';
import {
  formatFieldType,
  getTruncatedFilename,
} from '@utils/mentionFormatters';
import { useElementLayout } from 'datocms-react-ui/hooks/useElementLayout';
import Pill from 'datocms-react-ui/Pill';
import RawButton from 'datocms-react-ui/RawButton';
import Tooltip from 'datocms-react-ui/Tooltip';
import {
  memo,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/utils/cn';
import {
  AssetMentionIcon,
  ModelMentionIcon,
  RecordDocumentIcon,
} from '../Icons';
import styles from './MentionDisplay.module.css';

type MentionDisplayProps = {
  mention: Mention;
  /** A CMS path that the mention opens as a link, in place of onClick */
  to?: string;
  onClick?: (e: React.MouseEvent) => void;
  isClickable?: boolean;
  isProjectOwner?: boolean;
  /** The Tab order of the asset preview (a pill is always a tab stop) */
  tabIndex?: number;
  projectUsers?: UserInfo[];
};

type ClickHandler = (e: React.MouseEvent) => void;

type MentionPillProps = {
  icon?: ReactNode;
  tooltip?: string | null;
  /** A CMS path: the pill is a link */
  to?: string;
  /** Without a path or a handler, the pill is a static reference */
  onClick?: ClickHandler;
  children: ReactNode;
};

/** A reference to another item in a text: a soft pill */
function MentionPill({
  icon,
  tooltip,
  to,
  onClick,
  children,
}: MentionPillProps) {
  const hint = tooltip || undefined;

  if (to) {
    return (
      <Pill tone="soft" icon={icon} tooltip={hint} to={to}>
        {children}
      </Pill>
    );
  }

  if (onClick) {
    return (
      <Pill tone="soft" icon={icon} tooltip={hint} onClick={onClick}>
        {children}
      </Pill>
    );
  }

  return (
    <Pill tone="soft" icon={icon} tooltip={hint}>
      {children}
    </Pill>
  );
}

/** An emoji of the data (the title of a record, the name of a model) */
function MentionEmoji({ emoji }: { emoji: string }) {
  return (
    <span className={styles.emoji} aria-hidden="true">
      {emoji}
    </span>
  );
}

type AssetMentionDisplayProps = {
  mention: Extract<Mention, { type: 'asset' }>;
  tabIndex: number;
  onClick: ClickHandler;
};

/** A file that is not an image or a video, or whose preview failed */
function AssetMentionPill({
  mention,
  onClick,
}: Omit<AssetMentionDisplayProps, 'tabIndex'>) {
  const truncatedName = getTruncatedFilename(mention.filename);

  return (
    <MentionPill
      icon={<AssetMentionIcon />}
      // The full name, only when the pill cuts it
      tooltip={truncatedName !== mention.filename ? mention.filename : null}
      onClick={onClick}
    >
      {truncatedName}
    </MentionPill>
  );
}

/** An image or a video: a preview tile with the file name under it */
function AssetPreviewTile({
  mention,
  tabIndex,
  onClick,
}: AssetMentionDisplayProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // The caption ends with an ellipsis when the tile is narrower than the
  // name: the tooltip then gives the full name, as the pill of a file does.
  // The width of the caption changes with the image and the frame.
  const captionRef = useRef<HTMLSpanElement>(null);
  const { width: captionWidth } = useElementLayout(captionRef);
  const [isCaptionCut, setIsCaptionCut] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The caption is measured again when its width or its text changes.
  useLayoutEffect(() => {
    const caption = captionRef.current;
    setIsCaptionCut(!!caption && caption.scrollWidth > caption.clientWidth);
  }, [captionWidth, mention.filename]);

  if (hasError) {
    return <AssetMentionPill mention={mention} onClick={onClick} />;
  }

  return (
    <Tooltip label={isCaptionCut && mention.filename}>
      <RawButton className={styles.tile} tabIndex={tabIndex} onClick={onClick}>
        <span
          className={cn(styles.tileMedia, isLoaded && styles.tileMediaLoaded)}
        >
          <img
            className={styles.tileImage}
            src={mention.thumbnailUrl ?? ''}
            // The caption below gives the name
            alt=""
            onLoad={() => setIsLoaded(true)}
            onError={() => setHasError(true)}
          />
        </span>
        <span ref={captionRef} className={styles.tileCaption}>
          {mention.filename}
        </span>
      </RawButton>
    </Tooltip>
  );
}

function AssetMentionDisplay({
  mention,
  tabIndex,
  onClick,
}: AssetMentionDisplayProps) {
  const isVisualMedia =
    mention.mimeType.startsWith('image/') ||
    mention.mimeType.startsWith('video/');

  if (mention.thumbnailUrl && isVisualMedia) {
    return (
      <AssetPreviewTile
        mention={mention}
        tabIndex={tabIndex}
        onClick={onClick}
      />
    );
  }

  return <AssetMentionPill mention={mention} onClick={onClick} />;
}

type RecordMentionDisplayProps = {
  mention: Extract<Mention, { type: 'record' }>;
  onClick: ClickHandler;
};

/**
 * The picture of a record in its pill: the thumbnail, else the emoji of its
 * title or model, else the icon of a record
 */
function RecordPicture({
  thumbnailUrl,
  emoji,
}: {
  thumbnailUrl: string | null;
  emoji: string | null;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (thumbnailUrl) {
    // A thumbnail that does not load becomes the icon of a record
    return failedUrl === thumbnailUrl ? (
      <RecordDocumentIcon />
    ) : (
      <img
        className={styles.recordThumbnail}
        src={thumbnailUrl}
        // The title of the record follows it
        alt=""
        onError={() => setFailedUrl(thumbnailUrl)}
      />
    );
  }

  return emoji ? <MentionEmoji emoji={emoji} /> : <RecordDocumentIcon />;
}

function RecordMentionDisplay({ mention, onClick }: RecordMentionDisplayProps) {
  const { emoji: titleEmoji, textWithoutEmoji: cleanTitle } =
    extractLeadingEmoji(mention.title);
  const displayTitle = titleEmoji ? cleanTitle : mention.title;

  return (
    <MentionPill
      icon={
        <RecordPicture
          thumbnailUrl={mention.thumbnailUrl}
          emoji={titleEmoji || mention.modelEmoji}
        />
      }
      tooltip={mention.isSingleton ? 'Singleton' : mention.modelName}
      onClick={onClick}
    >
      {displayTitle}
    </MentionPill>
  );
}

function ModelMentionDisplay({
  mention,
  onClick,
}: {
  mention: Extract<Mention, { type: 'model' }>;
  onClick: ClickHandler;
}) {
  const { emoji, textWithoutEmoji } = extractLeadingEmoji(mention.name);
  const kind = mention.isBlockModel ? 'Block' : 'Model';

  return (
    <MentionPill
      icon={emoji ? <MentionEmoji emoji={emoji} /> : <ModelMentionIcon />}
      tooltip={`${kind} · ${mention.apiKey}`}
      onClick={onClick}
    >
      {textWithoutEmoji}
    </MentionPill>
  );
}

function getUserTooltip(
  mention: Extract<Mention, { type: 'user' }>,
  isProjectOwner: boolean,
): string {
  if (isProjectOwner) return 'Project owner';
  return mention.email || 'Organization';
}

function getFieldLabel(mention: Extract<Mention, { type: 'field' }>): string {
  const locale =
    mention.localized && mention.locale
      ? ` · ${mention.locale.toUpperCase()}`
      : '';
  return `#${mention.apiKey}${locale}`;
}

const MentionDisplayComponent = ({
  mention,
  to,
  onClick,
  isClickable = true,
  isProjectOwner = false,
  tabIndex = 0,
  projectUsers,
}: MentionDisplayProps) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(e);
  };

  // A user or a field that cannot be opened (the owner, a field the sidebar
  // cannot scroll to) is a static pill
  const clickHandler = isClickable ? handleClick : undefined;

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
        <MentionPill
          tooltip={getUserTooltip(mention, isProjectOwner)}
          onClick={clickHandler}
        >
          @{resolvedUserName}
        </MentionPill>
      );

    case 'field':
      return (
        <MentionPill
          tooltip={formatFieldType(mention.fieldType)}
          to={isClickable ? to : undefined}
          onClick={clickHandler}
        >
          {getFieldLabel(mention)}
        </MentionPill>
      );

    case 'asset':
      return (
        <AssetMentionDisplay
          mention={mention}
          tabIndex={tabIndex}
          onClick={handleClick}
        />
      );

    case 'record':
      return <RecordMentionDisplay mention={mention} onClick={handleClick} />;

    case 'model':
      return <ModelMentionDisplay mention={mention} onClick={handleClick} />;

    default:
      return null;
  }
};

export const MentionDisplay = memo(
  MentionDisplayComponent,
  (prevProps, nextProps) => {
    if (prevProps.isClickable !== nextProps.isClickable) return false;
    if (prevProps.to !== nextProps.to) return false;
    if (prevProps.isProjectOwner !== nextProps.isProjectOwner) return false;
    if (prevProps.tabIndex !== nextProps.tabIndex) return false;
    if (prevProps.onClick !== nextProps.onClick) return false;
    if (prevProps.projectUsers !== nextProps.projectUsers) return false;

    return areMentionsEqual(prevProps.mention, nextProps.mention);
  },
);
