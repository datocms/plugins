import Callout from 'datocms-react-ui/Callout';
import EntityRow from 'datocms-react-ui/EntityRow';
import IconAvatar, { type IconAvatarProps } from 'datocms-react-ui/IconAvatar';
import Pill from 'datocms-react-ui/Pill';
import RecordRow from 'datocms-react-ui/RecordRow';
import RowList from 'datocms-react-ui/RowList';
import Spinner from 'datocms-react-ui/Spinner';
import UploadPreview from 'datocms-react-ui/UploadPreview';
import UserRow from 'datocms-react-ui/UserRow';
import { type ReactNode, useId, useState } from 'react';
import { FieldIcon, FileIcon, ModelIcon } from '../../icons';
import type { AgentMentionHost } from '../../lib/mentionHost';
import type { Mention } from '../../lib/mentions';
import { extractLeadingEmoji } from '../../recordComments/entrypoints/utils/emojiUtils';
import { formatLocale } from '../../recordComments/entrypoints/utils/mentionFormatters';
import type {
  AgentAssetsEntry,
  AgentFieldsEntry,
  AgentMentionsEntry,
  AgentRecordsEntry,
  AgentSurfaceProps,
} from '../AgentSurface';
import { mentionIdentity, withStableKeys } from './keys';
import styles from './Transcript.module.css';

/** A host action reports its own failure in the receipt */
function ignoreHostActionFailure(result: void | Promise<void>) {
  void Promise.resolve(result).catch(() => undefined);
}

/** The spinner at the end of the row whose dialog is opening */
const openingSpinner = <Spinner inline label={false} />;

type RowIcon = IconAvatarProps['icon'];

/** The side of the picture slot of an entity row (layout="row") */
const ROW_IMAGE_SIZE = 32;

/** The preview of an asset in the picture slot of a row */
const ROW_PREVIEW_BOX = { width: ROW_IMAGE_SIZE, height: ROW_IMAGE_SIZE };
const ROW_PREVIEW_PADDING: [number, number] = [0, 0];

/**
 * The picture of a row of an entity that is not a record, a person or an
 * asset: an emoji, else the icon of the kind of thing on an icon avatar
 */
function RowPicture({ emoji, icon }: { emoji?: string | null; icon: RowIcon }) {
  if (emoji) {
    return (
      <span aria-hidden="true" className={styles.rowEmoji}>
        {emoji}
      </span>
    );
  }

  return <IconAvatar icon={icon} size={ROW_IMAGE_SIZE} surface="muted" />;
}

/**
 * An asset of the Media Area in the picture slot of a row, as the Media Area
 * draws it. The host loads the asset from its ID; a deleted asset has none.
 */
function assetPicture(uploadId: string | null) {
  return (
    <UploadPreview
      box={ROW_PREVIEW_BOX}
      padding={ROW_PREVIEW_PADDING}
      transparent
      upload={uploadId}
    />
  );
}

/** The language of a locale, as the editor knows it ("English") */
function language(locale: string | undefined) {
  return locale ? formatLocale(locale) : undefined;
}

function picture(icon: RowIcon, emoji?: string | null) {
  return <RowPicture emoji={emoji} icon={icon} />;
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
  records,
  title,
}: {
  busy?: boolean;
  children: ReactNode;
  /** The rows are records: their titles line up, with or without an image */
  records?: boolean;
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
          {records ? (
            <RecordRow.List>
              <RowList>{children}</RowList>
            </RecordRow.List>
          ) : (
            <RowList>{children}</RowList>
          )}
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

/**
 * A record as DatoCMS lists it: its image, its model, its title and its
 * status, which the row loads from the host by the ID of the record. The
 * record open next to the agent says so below its title.
 */
function recordRow(itemId: string, isCurrent: boolean) {
  return (
    <RecordRow item={itemId} layout="row">
      {isCurrent ? 'Current record' : undefined}
    </RecordRow>
  );
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
  onOpenRecord,
}: {
  currentRecordId?: string;
  entry: AgentRecordsEntry;
  /** A host action runs, or a record of this receipt opens */
  locked: boolean;
  onOpenRecord?: AgentSurfaceProps['onOpenRecord'];
}) {
  const [openedKey, setOpenedKey] = useState<string>();

  return (
    <Receipt
      busy={entry.opening}
      error={entry.error}
      fallbackLabel="Records"
      hasRows={entry.records.length > 0}
      records
      title={entry.title}
    >
      {entry.records.map((record) => {
        const key = `${record.itemTypeId ?? 'record'}:${record.itemId}`;
        const isCurrent = record.itemId === currentRecordId;
        const row = (
          <>
            {recordRow(record.itemId, isCurrent)}
            {entry.opening && openedKey === key && openingSpinner}
          </>
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
        // The label and the language: the path of the field is internal
        const row = (
          <EntityRow
            aside={language(field.locale)}
            image={picture(FieldIcon)}
            layout="row"
            title={field.title.trim() || field.fieldPath}
            trailing={entry.openingKey === key ? openingSpinner : undefined}
          />
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
        const row = (
          <EntityRow
            afterTitle={asset.deleted ? <Pill>Deleted</Pill> : undefined}
            image={assetPicture(asset.deleted ? null : asset.uploadId)}
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
        <UserRow
          layout="row"
          presentation={{
            name: mention.name,
            email: mention.email || null,
            imageUrl: mention.avatarUrl,
          }}
        >
          {isOwner ? 'Project owner' : mention.email || 'Organization'}
        </UserRow>
      );

    case 'model': {
      const { emoji, textWithoutEmoji } = extractLeadingEmoji(mention.name);

      return (
        <EntityRow
          afterTitle={mention.isBlockModel && <Pill>Block</Pill>}
          image={picture(ModelIcon, emoji)}
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
          Attached file
        </EntityRow>
      );

    case 'record':
      return recordRow(mention.id, isCurrentRecord);

    case 'field':
      return (
        <EntityRow
          aside={mention.localized ? language(mention.locale) : undefined}
          image={picture(FieldIcon)}
          layout="row"
          title={mention.label.trim() || mention.apiKey}
        />
      );

    case 'asset':
      return (
        <EntityRow
          image={assetPicture(mention.id)}
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
