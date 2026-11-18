import type { Mention } from '@ctypes/mentions';
import type { UserInfo } from '@hooks/useMentions';
import { getUserRowPresentation } from '@utils/avatarImage';
import { areMentionsEqual } from '@utils/comparisonHelpers';
import { extractLeadingEmoji } from '@utils/emojiUtils';
import { formatFieldType } from '@utils/mentionFormatters';
import Pill from 'datocms-react-ui/Pill';
import RecordRow from 'datocms-react-ui/RecordRow';
import UploadPreview from 'datocms-react-ui/UploadPreview';
import UserRow from 'datocms-react-ui/UserRow';
import { memo, type ReactNode, useMemo } from 'react';
import { ModelMentionIcon } from '../Icons';
import styles from './MentionDisplay.module.css';

type MentionDisplayProps = {
  mention: Mention;
  /** A CMS path that the mention opens as a link, in place of onClick */
  to?: string;
  onClick?: (e: React.MouseEvent) => void;
  isClickable?: boolean;
  isProjectOwner?: boolean;
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

/**
 * The preview of an asset in its pill, as the Media Area draws it: the image,
 * the frame of a video or the icon of the format. The host loads the asset
 * from its ID.
 */
const ASSET_PREVIEW_BOX = { width: 16, height: 16 };
const ASSET_PREVIEW_PADDING: [number, number] = [1, 1];

/** A file: its preview, then its name */
function AssetMentionDisplay({
  mention,
  onClick,
}: {
  mention: Extract<Mention, { type: 'asset' }>;
  onClick: ClickHandler;
}) {
  return (
    <MentionPill
      icon={
        <UploadPreview
          upload={mention.id}
          box={ASSET_PREVIEW_BOX}
          padding={ASSET_PREVIEW_PADDING}
          transparent
        />
      }
      // The pill cuts a name that doesn't fit the line: the hint keeps it whole
      tooltip={mention.filename}
      onClick={onClick}
    >
      {mention.filename}
    </MentionPill>
  );
}

type RecordMentionDisplayProps = {
  mention: Extract<Mention, { type: 'record' }>;
  onClick: ClickHandler;
};

/**
 * A record as DatoCMS shows it in a text: its image, its title and its
 * status. The row loads them from the host, from the ID of the record.
 */
function RecordMentionDisplay({ mention, onClick }: RecordMentionDisplayProps) {
  return (
    <MentionPill
      tooltip={mention.isSingleton ? 'Singleton' : mention.modelName}
      onClick={onClick}
    >
      <RecordRow layout="inline" item={mention.id} />
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

/** The label of the field, as the form names it, and its locale */
function getFieldLabel(mention: Extract<Mention, { type: 'field' }>): string {
  const locale =
    mention.localized && mention.locale
      ? ` · ${mention.locale.toUpperCase()}`
      : '';
  return `${mention.label}${locale}`;
}

/** The API key and the type of the field, for the tooltip of its pill */
function getFieldTooltip(mention: Extract<Mention, { type: 'field' }>): string {
  return [mention.apiKey, formatFieldType(mention.fieldType)]
    .filter(Boolean)
    .join(' · ');
}

const MentionDisplayComponent = ({
  mention,
  to,
  onClick,
  isClickable = true,
  isProjectOwner = false,
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
          <UserRow
            layout="inline"
            presentation={getUserRowPresentation({
              ...mention,
              name: resolvedUserName,
            })}
          />
        </MentionPill>
      );

    case 'field':
      return (
        <MentionPill
          tooltip={getFieldTooltip(mention)}
          to={isClickable ? to : undefined}
          onClick={clickHandler}
        >
          {getFieldLabel(mention)}
        </MentionPill>
      );

    case 'asset':
      return <AssetMentionDisplay mention={mention} onClick={handleClick} />;

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
    if (prevProps.onClick !== nextProps.onClick) return false;
    if (prevProps.projectUsers !== nextProps.projectUsers) return false;

    return areMentionsEqual(prevProps.mention, nextProps.mention);
  },
);
