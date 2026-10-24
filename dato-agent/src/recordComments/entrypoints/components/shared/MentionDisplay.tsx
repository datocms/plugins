import type { Mention } from '@ctypes/mentions';
import type { UserInfo } from '@hooks/useMentions';
import { areMentionsEqual } from '@utils/comparisonHelpers';
import { extractLeadingEmoji } from '@utils/emojiUtils';
import {
  formatFieldType,
  getTruncatedFilename,
} from '@utils/mentionFormatters';
import Avatar from 'datocms-react-ui/Avatar';
import MediaCard from 'datocms-react-ui/MediaCard';
import Pill from 'datocms-react-ui/Pill';
import RawButton from 'datocms-react-ui/RawButton';
import Tooltip from 'datocms-react-ui/Tooltip';
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react';
import { AssetIcon, FileIcon, ModelIcon, RecordIcon } from '../../../../icons';
import { getSessionLocalFile } from '../../../../lib/localFiles';
import styles from './MentionDisplay.module.css';

type MentionDisplayProps = {
  mention: Mention;
  onClick?: (e: React.MouseEvent) => void;
  /** False shows the reference as a static pill, which never opens */
  isClickable?: boolean;
  /** The mentioned user owns the project: the hint says so */
  isProjectOwner?: boolean;
  /**
   * The reference is a node of the composer's editor: a static pill in a
   * button that is not a tab stop, and never a preview card.
   */
  inComposer?: boolean;
  /** Project users, to show the current name of a mentioned user */
  projectUsers?: UserInfo[];
  /** The record open next to the agent: its reference never opens */
  currentRecordId?: string;
};

type ClickHandler = (e: React.MouseEvent) => void;

/** What a reference pill shows */
type ReferenceView = {
  icon?: ReactNode;
  text: string;
  /** The hint of the tooltip */
  hint?: string;
  /** The reference never opens, whatever the caller allows */
  inert?: boolean;
};

type ReferenceProps = {
  /** True when the caller lets the reference open and gives an action */
  canOpen: boolean;
  inComposer: boolean;
  /** A visual asset or image file shows as a compact card, not a pill */
  previewCard: boolean;
  onClick: ClickHandler;
};

function isVisualMimeType(mimeType: string) {
  return mimeType.startsWith('image/') || mimeType.startsWith('video/');
}

/** A thumbnail in a pill. When the image does not load, it shows the glyph. */
function PillThumbnail({
  fallback,
  src,
}: {
  fallback: ReactNode;
  src: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return fallback;

  return (
    <img
      alt=""
      className={styles.thumbnail}
      onError={() => setFailed(true)}
      src={src}
    />
  );
}

function ReferencePill({
  canOpen,
  inComposer,
  onClick,
  view,
}: ReferenceProps & { view: ReferenceView }) {
  const { hint, icon, text } = view;
  const opens = canOpen && !view.inert;

  // In the editor, a reference opens on click but is not a tab stop: a
  // static pill in a button with tabIndex -1. A tooltip on the pill itself
  // would make it focusable, so the hint goes on the button.
  if (inComposer) {
    return (
      <Tooltip label={hint}>
        <RawButton
          className={styles.editorReference}
          disabled={opens ? undefined : 'focusable'}
          onClick={opens ? onClick : undefined}
          tabIndex={-1}
        >
          <Pill icon={icon} tone="soft">
            {text}
          </Pill>
        </RawButton>
      </Tooltip>
    );
  }

  if (opens) {
    return (
      <Pill icon={icon} onClick={onClick} tone="soft" tooltip={hint}>
        {text}
      </Pill>
    );
  }

  return (
    <Pill icon={icon} tone="soft" tooltip={hint}>
      {text}
    </Pill>
  );
}

/** A visual asset or image file in a message: a compact card */
function PreviewCard({
  canOpen,
  filename,
  onClick,
  onError,
  src,
}: {
  canOpen: boolean;
  filename: string;
  onClick: ClickHandler;
  onError: () => void;
  src: string;
}) {
  const image = (
    <img alt="" className={styles.previewImage} onError={onError} src={src} />
  );

  return (
    <div className={styles.preview}>
      {canOpen ? (
        <MediaCard caption={filename} isCompact onClick={onClick}>
          {image}
        </MediaCard>
      ) : (
        <MediaCard caption={filename} isCompact>
          {image}
        </MediaCard>
      )}
    </div>
  );
}

type FileLikeReferenceProps = ReferenceProps & {
  filename: string;
  /** The image of the preview card and of the thumbnail, when it is visual */
  previewUrl: string | null;
  icon: ReactNode;
};

/**
 * An asset or a file from the computer: a preview card for an image in a
 * message, else a pill with the filename (and the thumbnail of an image in
 * the editor). When the card's image does not load,
 * the reference falls back to the pill with the glyph.
 */
function FileLikeReference({
  filename,
  icon,
  previewUrl,
  ...referenceProps
}: FileLikeReferenceProps) {
  const [previewFailed, setPreviewFailed] = useState(false);

  if (previewUrl && referenceProps.previewCard && !previewFailed) {
    return (
      <PreviewCard
        canOpen={referenceProps.canOpen}
        filename={filename}
        onClick={referenceProps.onClick}
        onError={() => setPreviewFailed(true)}
        src={previewUrl}
      />
    );
  }

  const text = getTruncatedFilename(filename);
  const showsThumbnail = previewUrl && !previewFailed;

  return (
    <ReferencePill
      {...referenceProps}
      view={{
        icon: showsThumbnail ? (
          <PillThumbnail fallback={icon} key={previewUrl} src={previewUrl} />
        ) : (
          icon
        ),
        text,
        // The full name, when the pill cuts it
        hint: text === filename ? undefined : filename,
      }}
    />
  );
}

function AssetReference({
  mention,
  ...props
}: ReferenceProps & {
  mention: Extract<Mention, { type: 'asset' }>;
}) {
  const previewUrl =
    mention.thumbnailUrl && isVisualMimeType(mention.mimeType)
      ? mention.thumbnailUrl
      : null;

  return (
    <FileLikeReference
      {...props}
      filename={mention.filename}
      icon={<AssetIcon />}
      key={previewUrl ?? ''}
      previewUrl={previewUrl}
    />
  );
}

/** A file from the computer: its image shows while the bytes are in the session */
function LocalFileReference({
  mention,
  ...props
}: ReferenceProps & {
  mention: Extract<Mention, { type: 'file' }>;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const file = getSessionLocalFile(mention.id);
    if (
      !file ||
      !mention.mimeType.startsWith('image/') ||
      typeof URL.createObjectURL !== 'function'
    ) {
      setPreviewUrl(null);
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [mention.id, mention.mimeType]);

  return (
    <FileLikeReference
      {...props}
      filename={mention.filename}
      icon={<FileIcon />}
      key={previewUrl ?? ''}
      previewUrl={previewUrl}
    />
  );
}

function userView(
  mention: Extract<Mention, { type: 'user' }>,
  resolvedName: string,
  isProjectOwner: boolean,
): ReferenceView {
  return {
    // The box keeps the avatar square when a long name fills the pill
    icon: (
      <span className={styles.avatar}>
        <Avatar
          email={mention.email || null}
          imageUrl={mention.avatarUrl}
          name={resolvedName}
          size="small"
        />
      </span>
    ),
    text: `@${resolvedName}`,
    hint: isProjectOwner ? 'Project owner' : mention.email || 'Organization',
  };
}

// The '#' of the text is the glyph of a field: the pill has no icon.
function fieldView(
  mention: Extract<Mention, { type: 'field' }>,
): ReferenceView {
  const locale = mention.localized && mention.locale ? mention.locale : null;

  return {
    text: locale ? `#${mention.apiKey} · ${locale}` : `#${mention.apiKey}`,
    hint: formatFieldType(mention.fieldType) ?? undefined,
  };
}

function emojiIcon(emoji: string) {
  return (
    <span aria-hidden="true" className={styles.emoji}>
      {emoji}
    </span>
  );
}

/** The thumbnail, else the emoji of the title or of the model, else the glyph */
function recordIcon(
  mention: Extract<Mention, { type: 'record' }>,
  titleEmoji: string | null,
): ReactNode {
  if (mention.thumbnailUrl) {
    return (
      <PillThumbnail
        fallback={<RecordIcon />}
        key={mention.thumbnailUrl}
        src={mention.thumbnailUrl}
      />
    );
  }

  const emoji =
    titleEmoji || mention.modelEmoji || (mention.isSingleton ? '📄' : null);
  return emoji ? emojiIcon(emoji) : <RecordIcon />;
}

function recordHint(
  mention: Extract<Mention, { type: 'record' }>,
  isCurrentRecord: boolean,
) {
  if (isCurrentRecord) return 'Current record';
  if (mention.isSingleton) return 'Singleton';
  return mention.modelName;
}

function recordView(
  mention: Extract<Mention, { type: 'record' }>,
  isCurrentRecord: boolean,
): ReferenceView {
  const { emoji: titleEmoji, textWithoutEmoji } = extractLeadingEmoji(
    mention.title,
  );

  return {
    icon: recordIcon(mention, titleEmoji),
    text: titleEmoji ? textWithoutEmoji : mention.title,
    hint: recordHint(mention, isCurrentRecord),
    inert: isCurrentRecord,
  };
}

function modelView(
  mention: Extract<Mention, { type: 'model' }>,
): ReferenceView {
  const { emoji, textWithoutEmoji } = extractLeadingEmoji(mention.name);

  return {
    icon: emoji ? emojiIcon(emoji) : <ModelIcon />,
    text: textWithoutEmoji,
    hint: `${mention.isBlockModel ? 'Block' : 'Model'}: ${mention.apiKey}`,
  };
}

/** The name of a mentioned user, as the project knows it now */
function useResolvedUserName(mention: Mention, projectUsers?: UserInfo[]) {
  return useMemo(() => {
    if (mention.type !== 'user') return '';
    if (!projectUsers) return mention.name;

    const matchingUser =
      projectUsers.find((user) => user.id === mention.id) ??
      (mention.email
        ? projectUsers.find(
            (user) => user.email && user.email === mention.email,
          )
        : undefined);

    return matchingUser ? matchingUser.name : mention.name;
  }, [mention, projectUsers]);
}

/**
 * A reference in a message or in the composer: a soft pill with the icon of
 * the thing and a hint, or a compact card for a visual asset in a message.
 */
const MentionDisplayComponent = ({
  mention,
  onClick,
  isClickable = true,
  isProjectOwner = false,
  inComposer = false,
  projectUsers,
  currentRecordId,
}: MentionDisplayProps) => {
  const resolvedUserName = useResolvedUserName(mention, projectUsers);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(e);
  };

  const referenceProps: ReferenceProps = {
    canOpen: isClickable && Boolean(onClick),
    inComposer,
    // The editor shows every reference as a pill in the line
    previewCard: !inComposer,
    onClick: handleClick,
  };

  switch (mention.type) {
    case 'user':
      return (
        <ReferencePill
          {...referenceProps}
          view={userView(mention, resolvedUserName, isProjectOwner)}
        />
      );

    case 'field':
      return <ReferencePill {...referenceProps} view={fieldView(mention)} />;

    case 'asset':
      return <AssetReference {...referenceProps} mention={mention} />;

    case 'file':
      return <LocalFileReference {...referenceProps} mention={mention} />;

    case 'record':
      return (
        <ReferencePill
          {...referenceProps}
          view={recordView(mention, mention.id === currentRecordId)}
        />
      );

    case 'model':
      return <ReferencePill {...referenceProps} view={modelView(mention)} />;

    default:
      return null;
  }
};

export const MentionDisplay = memo(
  MentionDisplayComponent,
  (prevProps, nextProps) => {
    if (prevProps.isClickable !== nextProps.isClickable) return false;
    if (prevProps.isProjectOwner !== nextProps.isProjectOwner) return false;
    if (prevProps.inComposer !== nextProps.inComposer) return false;
    if (prevProps.onClick !== nextProps.onClick) return false;
    if (prevProps.projectUsers !== nextProps.projectUsers) return false;
    if (prevProps.currentRecordId !== nextProps.currentRecordId) return false;

    return areMentionsEqual(prevProps.mention, nextProps.mention);
  },
);
