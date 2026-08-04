import type { Client } from '@datocms/cma-client-browser';
import type { Field, ItemType, Upload } from 'datocms-plugin-sdk';
import type {
  AssetMention,
  RecordMention,
} from '../recordComments/entrypoints/types/mentions';
import { extractLeadingEmoji } from '../recordComments/entrypoints/utils/emojiUtils';

export type RecordMentionModel = {
  id: string;
  apiKey: string;
  name: string;
};

export type RecordMentionData = {
  id: string;
  values: Record<string, unknown>;
};

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function localizedValue(value: unknown, mainLocale: string): unknown {
  const localized = objectValue(value);
  return localized && mainLocale in localized ? localized[mainLocale] : value;
}

function fallbackRecordTitle(recordId: string): string {
  return `Record #${recordId}`;
}

/** Mirrors Record Comments: singleton -> presentation title -> title -> ID. */
export function recordMentionTitle({
  fields,
  itemType,
  mainLocale,
  modelName,
  record,
}: {
  fields: readonly Field[];
  itemType: ItemType | undefined;
  mainLocale: string;
  modelName: string;
  record: RecordMentionData;
}): string {
  if (itemType?.attributes.singleton) return modelName;

  const titleFieldId =
    itemType?.relationships.presentation_title_field?.data?.id ??
    itemType?.relationships.title_field?.data?.id;
  const titleField = fields.find((field) => field.id === titleFieldId);
  if (!titleField) return fallbackRecordTitle(record.id);

  const rawValue = record.values[titleField.attributes.api_key];
  const value = localizedValue(rawValue, mainLocale);
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && !value.trim()) ||
    typeof value === 'object'
  ) {
    return fallbackRecordTitle(record.id);
  }

  return String(value);
}

function uploadIdFromFieldValue(
  fieldValue: unknown,
  mainLocale: string,
): string | undefined {
  const resolved = localizedValue(fieldValue, mainLocale);
  const first = Array.isArray(resolved) ? resolved[0] : resolved;
  const upload = objectValue(first);
  return typeof upload?.upload_id === 'string' ? upload.upload_id : undefined;
}

export function mentionThumbnailUrl({
  mimeType,
  muxPlaybackId,
  url,
  width,
}: {
  mimeType: string;
  muxPlaybackId?: string | null;
  url?: string | null;
  width: number;
}): string | null {
  if (mimeType.startsWith('image/') && url) {
    return `${url}?w=${width}&fit=max&auto=format&dpr=2&q=80`;
  }
  if (mimeType.startsWith('video/') && muxPlaybackId) {
    return `https://image.mux.com/${muxPlaybackId}/thumbnail.jpg?width=${width}&fit_mode=preserve`;
  }
  return null;
}

async function thumbnailForUpload(
  client: Client,
  uploadId: string,
  width: number,
): Promise<string | null> {
  try {
    const upload = await client.uploads.find(uploadId);
    return mentionThumbnailUrl({
      mimeType: upload.mime_type ?? '',
      muxPlaybackId: upload.mux_playback_id,
      url: upload.url,
      width,
    });
  } catch {
    return null;
  }
}

async function thumbnailForRecordField({
  client,
  field,
  mainLocale,
  record,
}: {
  client: Client;
  field: Field;
  mainLocale: string;
  record: RecordMentionData;
}): Promise<string | null> {
  const uploadId = uploadIdFromFieldValue(
    record.values[field.attributes.api_key],
    mainLocale,
  );
  return uploadId ? thumbnailForUpload(client, uploadId, 48) : null;
}

async function recordMentionThumbnail({
  client,
  fields,
  itemType,
  mainLocale,
  record,
}: {
  client: Client | null;
  fields: readonly Field[];
  itemType: ItemType | undefined;
  mainLocale: string;
  record: RecordMentionData;
}): Promise<string | null> {
  if (
    !client ||
    !itemType ||
    itemType.attributes.collection_appearance === 'compact'
  ) {
    return null;
  }

  const configuredImageFieldId =
    itemType.relationships.presentation_image_field?.data?.id ??
    itemType.relationships.image_preview_field?.data?.id;
  const configuredImageField = fields.find(
    (field) => field.id === configuredImageFieldId,
  );
  if (configuredImageField) {
    const configuredThumbnail = await thumbnailForRecordField({
      client,
      field: configuredImageField,
      mainLocale,
      record,
    });
    if (configuredThumbnail) return configuredThumbnail;
  }

  const mediaFields = fields
    .slice()
    .sort((left, right) => left.attributes.position - right.attributes.position)
    .filter(
      (field) =>
        field.attributes.field_type === 'file' ||
        field.attributes.field_type === 'gallery',
    );
  for (const field of mediaFields) {
    if (field.id === configuredImageField?.id) continue;
    // biome-ignore lint/performance/noAwaitInLoops: preserve field priority without fetching every media upload.
    const thumbnail = await thumbnailForRecordField({
      client,
      field,
      mainLocale,
      record,
    });
    if (thumbnail) return thumbnail;
  }
  return null;
}

export async function createRecordMention({
  client,
  fields,
  itemType,
  mainLocale,
  model,
  record,
}: {
  client: Client | null;
  fields: readonly Field[];
  itemType: ItemType | undefined;
  mainLocale: string;
  model: RecordMentionModel;
  record: RecordMentionData;
}): Promise<RecordMention> {
  const isSingleton = itemType?.attributes.singleton ?? false;
  return {
    type: 'record',
    id: record.id,
    title: recordMentionTitle({
      fields,
      itemType,
      mainLocale,
      modelName: model.name,
      record,
    }),
    modelId: model.id,
    modelApiKey: model.apiKey,
    modelName: model.name,
    modelEmoji: extractLeadingEmoji(model.name).emoji,
    thumbnailUrl: await recordMentionThumbnail({
      client,
      fields,
      itemType,
      mainLocale,
      record,
    }),
    ...(isSingleton ? { isSingleton: true } : {}),
  };
}

export function createAssetMention(upload: Upload): AssetMention {
  const mimeType = upload.attributes.mime_type ?? 'application/octet-stream';
  const url = upload.attributes.url ?? '';
  return {
    type: 'asset',
    id: upload.id,
    filename: upload.attributes.filename,
    url,
    thumbnailUrl: mentionThumbnailUrl({
      mimeType,
      muxPlaybackId: upload.attributes.mux_playback_id,
      url,
      width: 300,
    }),
    mimeType,
  };
}

export async function resolveAssetMention(
  client: Client,
  uploadId: string,
): Promise<AssetMention> {
  const upload = await client.uploads.find(uploadId);
  const mimeType = upload.mime_type ?? 'application/octet-stream';
  const url = upload.url ?? '';
  return {
    type: 'asset',
    id: upload.id,
    filename: upload.filename ?? upload.basename ?? `Asset #${upload.id}`,
    url,
    thumbnailUrl: mentionThumbnailUrl({
      mimeType,
      muxPlaybackId: upload.mux_playback_id,
      url,
      width: 300,
    }),
    mimeType,
  };
}
