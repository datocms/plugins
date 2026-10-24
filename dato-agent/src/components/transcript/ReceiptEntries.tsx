import ApiKey from 'datocms-react-ui/ApiKey';
import Avatar from 'datocms-react-ui/Avatar';
import Callout from 'datocms-react-ui/Callout';
import EntityRow from 'datocms-react-ui/EntityRow';
import IconAvatar, { type IconAvatarProps } from 'datocms-react-ui/IconAvatar';
import IdText from 'datocms-react-ui/IdText';
import Pill from 'datocms-react-ui/Pill';
import RowList from 'datocms-react-ui/RowList';
import Spinner from 'datocms-react-ui/Spinner';
import { type ReactNode, useId, useState } from 'react';
import {
  AssetIcon,
  FieldIcon,
  FileIcon,
  ModelIcon,
  RecordIcon,
} from '../../icons';
import type { AgentMentionHost } from '../../lib/mentionHost';
import type { Mention } from '../../lib/mentions';
import { extractLeadingEmoji } from '../../recordComments/entrypoints/utils/emojiUtils';
import type {
  AgentAssetsEntry,
  AgentFieldsEntry,
  AgentMentionsEntry,
  AgentRecordResultViewModel,
  AgentRecordsEntry,
  AgentSurfaceProps,
} from '../AgentSurface';
import { mentionIdentity, withStableKeys } from './keys';
import styles from './Transcript.module.css';

/** A host action reports its own failure in the receipt */
function ignoreHostActionFailure(result: void | Promise<void>) {
  void Promise.resolve(result).catch(() => undefined);
}

function isVisualMimeType(mimeType: string) {
  return mimeType.startsWith('image/') || mimeType.startsWith('video/');
}

/** The spinner at the end of the row whose dialog is opening */
const openingSpinner = <Spinner inline label={false} />;

type RowIcon = IconAvatarProps['icon'];

/** The side of the picture slot of an entity row (layout="row") */
const ROW_IMAGE_SIZE = 32;

/**
 * The picture of a row: a thumbnail, else an emoji, else the icon of the
 * kind of thing on an icon avatar. A thumbnail that does not load shows the
 * icon.
 */
function RowPicture({
  emoji,
  icon,
  src,
}: {
  emoji?: string | null;
  icon: RowIcon;
  src?: string | null;
}) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img
        alt=""
        className={styles.rowThumbnail}
        onError={() => setFailed(true)}
        src={src}
      />
    );
  }

  if (emoji) {
    return (
      <span aria-hidden="true" className={styles.rowEmoji}>
        {emoji}
      </span>
    );
  }

  return <IconAvatar icon={icon} size={ROW_IMAGE_SIZE} surface="muted" />;
}

function picture(icon: RowIcon, src?: string | null, emoji?: string | null) {
  return <RowPicture emoji={emoji} icon={icon} key={src ?? ''} src={src} />;
}

/**
 * What the agent returned in a turn (records, fields, assets, references):
 * a group named by its title, a small caption, and one row for each thing.
 * The rows stay at the edge of the column, the error under them.
 */
function Receipt({
  busy,
  children,
  error,
  fallbackLabel,
  hasRows,
  title,
}: {
  busy?: boolean;
  children: ReactNode;
  error?: string;
  /** The name of the group when the agent gave no title */
  fallbackLabel: string;
  hasRows: boolean;
  title?: string;
}) {
  const titleId = useId();

  return (
    <div
      aria-busy={busy || undefined}
      aria-label={title ? undefined : fallbackLabel}
      aria-labelledby={title ? titleId : undefined}
      className={styles.receipt}
      role="group"
    >
      {title && (
        <p className={styles.receiptTitle} id={titleId}>
          {title}
        </p>
      )}
      {hasRows && (
        <div className={styles.receiptRows}>
          <RowList>{children}</RowList>
        </div>
      )}
      {error && (
        <Callout className={styles.callout} tone="danger">
          {error}
        </Callout>
      )}
    </div>
  );
}

type RecordRowContent = {
  image: ReactNode;
  kicker?: string;
  title: string;
  /** The ID of a record without a title, which tells it from the others */
  details?: ReactNode;
};

function recordRowContent(
  record: Pick<AgentRecordResultViewModel, 'itemId' | 'title' | 'mention'>,
  modelName: string | undefined,
): RecordRowContent {
  const trimmedTitle = record.title.trim();
  // The fallback title of the lib is the ID behind a "#": the row says the
  // record has no title and shows the ID as an ID
  const untitled = !trimmedTitle || trimmedTitle === `Record #${record.itemId}`;
  const rawTitle = untitled ? 'Untitled record' : trimmedTitle;
  const { emoji, textWithoutEmoji } = extractLeadingEmoji(rawTitle);
  const mention = record.mention;

  return {
    image: picture(
      RecordIcon,
      mention?.thumbnailUrl,
      emoji || mention?.modelEmoji || (mention?.isSingleton ? '📄' : undefined),
    ),
    kicker: modelName,
    title: (emoji && textWithoutEmoji.trim()) || rawTitle,
    details: untitled ? <IdText id={record.itemId} /> : undefined,
  };
}

/**
 * The records of a turn. Each one opens its record; the record already open
 * next to the agent is the selected row and does not open. While a record
 * opens (or another host action runs), a click does nothing.
 */
export function RecordsEntry({
  currentRecordId,
  entry,
  locked,
  mentionHost,
  onOpenRecord,
}: {
  currentRecordId?: string;
  entry: AgentRecordsEntry;
  /** A host action runs, or a record of this receipt opens */
  locked: boolean;
  mentionHost: AgentMentionHost;
  onOpenRecord?: AgentSurfaceProps['onOpenRecord'];
}) {
  const [openedKey, setOpenedKey] = useState<string>();
  const modelsById = new Map(
    mentionHost.projectModels.map((model) => [model.id, model]),
  );

  return (
    <Receipt
      busy={entry.opening}
      error={entry.error}
      fallbackLabel="Records"
      hasRows={entry.records.length > 0}
      title={entry.title}
    >
      {entry.records.map((record) => {
        const key = `${record.itemTypeId ?? 'record'}:${record.itemId}`;
        const model = record.itemTypeId
          ? modelsById.get(record.itemTypeId)
          : undefined;
        const content = recordRowContent(
          record,
          record.mention?.modelName ?? model?.name ?? record.modelLabel,
        );
        const isCurrent = record.itemId === currentRecordId;
        const row = (
          <EntityRow
            aside={isCurrent ? 'Current record' : undefined}
            image={content.image}
            kicker={content.kicker}
            layout="row"
            title={content.title}
            trailing={
              entry.opening && openedKey === key ? openingSpinner : undefined
            }
          >
            {content.details}
          </EntityRow>
        );

        if (isCurrent) {
          return (
            <RowList.Item key={key} selected>
              {row}
            </RowList.Item>
          );
        }

        if (!onOpenRecord) {
          return <RowList.Item key={key}>{row}</RowList.Item>;
        }

        return (
          <RowList.Item
            key={key}
            onClick={() => {
              if (locked) return;
              setOpenedKey(key);
              ignoreHostActionFailure(onOpenRecord(record, entry.id));
            }}
          >
            {row}
          </RowList.Item>
        );
      })}
    </Receipt>
  );
}

/** The fields of a turn. Each one scrolls the record form to the field. */
export function FieldsEntry({
  entry,
  locked,
  onOpenField,
}: {
  entry: AgentFieldsEntry;
  /** A host action runs */
  locked: boolean;
  onOpenField?: AgentSurfaceProps['onOpenField'];
}) {
  const opening = Boolean(entry.openingKey);

  return (
    <Receipt
      busy={opening}
      error={entry.error}
      fallbackLabel="Fields"
      hasRows={entry.fields.length > 0}
      title={entry.title}
    >
      {entry.fields.map((field) => {
        const key = `${field.fieldPath}:${field.locale ?? ''}`;
        const row = (
          <EntityRow
            aside={field.locale}
            image={picture(FieldIcon)}
            layout="row"
            title={field.title.trim() || field.fieldPath}
            trailing={entry.openingKey === key ? openingSpinner : undefined}
          >
            {field.fieldPath}
          </EntityRow>
        );

        if (!onOpenField) {
          return <RowList.Item key={key}>{row}</RowList.Item>;
        }

        return (
          <RowList.Item
            key={key}
            onClick={() => {
              if (locked || opening) return;
              ignoreHostActionFailure(onOpenField(field, entry.id));
            }}
          >
            {row}
          </RowList.Item>
        );
      })}
    </Receipt>
  );
}

/**
 * The assets of a turn. Each one opens the asset editor; a deleted asset is
 * a muted row that says so and does not open.
 */
export function AssetsEntry({
  entry,
  locked,
  onOpenAsset,
}: {
  entry: AgentAssetsEntry;
  /** A host action runs */
  locked: boolean;
  onOpenAsset?: AgentSurfaceProps['onOpenAsset'];
}) {
  const opening = Boolean(entry.openingKey);

  return (
    <Receipt
      busy={opening}
      error={entry.error}
      fallbackLabel="Assets"
      hasRows={entry.assets.length > 0}
      title={entry.title}
    >
      {entry.assets.map((asset) => {
        const mention = asset.mention;
        const thumbnailUrl =
          mention?.thumbnailUrl && isVisualMimeType(mention.mimeType)
            ? mention.thumbnailUrl
            : null;
        const row = (
          <EntityRow
            afterTitle={asset.deleted ? <Pill>Deleted</Pill> : undefined}
            image={picture(AssetIcon, asset.deleted ? null : thumbnailUrl)}
            layout="row"
            title={asset.title.trim() || mention?.filename || asset.uploadId}
            trailing={
              entry.openingKey === asset.uploadId ? openingSpinner : undefined
            }
          />
        );

        if (asset.deleted) {
          return (
            <RowList.Item key={asset.uploadId} muted>
              {row}
            </RowList.Item>
          );
        }

        if (!onOpenAsset) {
          return <RowList.Item key={asset.uploadId}>{row}</RowList.Item>;
        }

        return (
          <RowList.Item
            key={asset.uploadId}
            onClick={() => {
              if (locked || opening) return;
              ignoreHostActionFailure(onOpenAsset(asset, entry.id));
            }}
          >
            {row}
          </RowList.Item>
        );
      })}
    </Receipt>
  );
}

type MentionRowProps = {
  mention: Mention;
  isOwner: boolean;
  isCurrentRecord: boolean;
};

/** The row of a reference, by its kind */
function MentionRow({ mention, isOwner, isCurrentRecord }: MentionRowProps) {
  switch (mention.type) {
    case 'user':
      return (
        <EntityRow
          image={
            <span className={styles.rowAvatar}>
              <Avatar
                email={mention.email || null}
                imageUrl={mention.avatarUrl}
                name={mention.name}
              />
            </span>
          }
          layout="row"
          title={mention.name}
        >
          {isOwner ? 'Project owner' : mention.email || 'Organization'}
        </EntityRow>
      );

    case 'model': {
      const { emoji, textWithoutEmoji } = extractLeadingEmoji(mention.name);

      return (
        <EntityRow
          afterTitle={
            <>
              <ApiKey>{mention.apiKey}</ApiKey>
              {mention.isBlockModel && <Pill>Block</Pill>}
            </>
          }
          image={picture(ModelIcon, null, emoji)}
          layout="row"
          title={(emoji && textWithoutEmoji.trim()) || mention.name}
        />
      );
    }

    case 'file':
      return (
        <EntityRow
          image={picture(FileIcon)}
          layout="row"
          title={mention.filename}
        >
          Not an asset yet
        </EntityRow>
      );

    case 'record': {
      const content = recordRowContent(
        { itemId: mention.id, title: mention.title, mention },
        mention.modelName,
      );

      return (
        <EntityRow
          aside={isCurrentRecord ? 'Current record' : undefined}
          image={content.image}
          kicker={content.kicker}
          layout="row"
          title={content.title}
        >
          {content.details}
        </EntityRow>
      );
    }

    case 'field':
      return (
        <EntityRow
          aside={mention.localized ? mention.locale : undefined}
          image={picture(FieldIcon)}
          layout="row"
          title={mention.label.trim() || mention.apiKey}
        >
          {mention.fieldPath}
        </EntityRow>
      );

    case 'asset':
      return (
        <EntityRow
          image={picture(
            AssetIcon,
            isVisualMimeType(mention.mimeType) ? mention.thumbnailUrl : null,
          )}
          layout="row"
          title={mention.filename}
        />
      );
  }
}

/**
 * What a click on a reference opens: a person, a model or the details of a
 * file from the computer. Other kinds have their own receipts.
 */
function mentionOpener(
  mention: Mention,
  mentionHost: AgentMentionHost,
): (() => void) | undefined {
  switch (mention.type) {
    case 'user':
      return () => ignoreHostActionFailure(mentionHost.openUser(mention.id));
    case 'model':
      return () => mentionHost.openModel(mention.id, mention.isBlockModel);
    case 'file':
      return () => ignoreHostActionFailure(mentionHost.openLocalFile(mention));
    default:
      return undefined;
  }
}

/**
 * Other references of a turn: people, models and files from the computer
 * open (the user, the model, the file details); the project owner and the
 * other kinds only show.
 */
export function MentionsEntry({
  currentRecordId,
  entry,
  locked,
  mentionHost,
}: {
  currentRecordId?: string;
  entry: AgentMentionsEntry;
  /** A host action runs */
  locked: boolean;
  mentionHost: AgentMentionHost;
}) {
  return (
    <Receipt
      error={entry.error}
      fallbackLabel="References"
      hasRows={entry.mentions.length > 0}
      title={entry.title}
    >
      {withStableKeys(entry.mentions, mentionIdentity).map(
        ({ key, value: mention }) => {
          const isOwner =
            mention.type === 'user' &&
            mention.id === mentionHost.projectOwnerId;
          const isCurrentRecord =
            mention.type === 'record' && mention.id === currentRecordId;
          const row = (
            <MentionRow
              isCurrentRecord={isCurrentRecord}
              isOwner={isOwner}
              mention={mention}
            />
          );

          if (isCurrentRecord) {
            return (
              <RowList.Item key={key} selected>
                {row}
              </RowList.Item>
            );
          }

          const open = isOwner
            ? undefined
            : mentionOpener(mention, mentionHost);

          if (!open) {
            return <RowList.Item key={key}>{row}</RowList.Item>;
          }

          return (
            <RowList.Item
              key={key}
              onClick={() => {
                if (!locked) open();
              }}
            >
              {row}
            </RowList.Item>
          );
        },
      )}
    </Receipt>
  );
}
