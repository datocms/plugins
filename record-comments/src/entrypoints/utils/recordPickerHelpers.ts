import type { Client } from '@datocms/cma-client-browser';
import { getThumbnailUrl } from '@/utils/helpers';
import { logError } from '@/utils/errorLogger';
import type { RecordMention } from '@ctypes/mentions';
import { extractLeadingEmoji } from './emojiUtils';
import { extractLocalizedValue } from './fieldLoader';
import {
  extractTitleFromRecordData,
  type TitleFieldConfig,
  type NormalizedField,
} from './recordTitleUtils';

function hasUploadId(value: unknown): value is { upload_id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'upload_id' in value &&
    typeof value.upload_id === 'string'
  );
}

type ItemTypeWithRelationships = {
  attributes: {
    singleton?: boolean;
    collection_appearance?: string;
  };
  relationships: {
    presentation_title_field: { data: { id: string } | null };
    title_field: { data: { id: string } | null };
    presentation_image_field: { data: { id: string } | null };
    image_preview_field: { data: { id: string } | null };
  };
};

type RecordField = {
  id: string;
  attributes: {
    api_key: string;
    position?: number;
    field_type: string;
  };
};

type RecordWithAttributes = {
  id: string;
  attributes: Record<string, unknown>;
};

export type RecordPickerModelInfo = {
  id: string;
  apiKey: string;
  name: string;
  isBlockModel: boolean;
};

export function extractRecordTitle(
  record: RecordWithAttributes,
  itemType: ItemTypeWithRelationships | undefined,
  fields: RecordField[],
  modelName: string,
  mainLocale: string
): string {
  if (!itemType) {
    return `Record #${record.id}`;
  }

  const titleFieldConfig: TitleFieldConfig = {
    presentationTitleFieldId: itemType.relationships.presentation_title_field.data?.id ?? null,
    titleFieldId: itemType.relationships.title_field.data?.id ?? null,
  };

  const normalizedFields: NormalizedField[] = fields.map((f) => ({
    id: f.id,
    apiKey: f.attributes.api_key,
  }));

  const isSingleton = itemType.attributes.singleton ?? false;

  return extractTitleFromRecordData(
    record.id,
    record.attributes,
    titleFieldConfig,
    normalizedFields,
    modelName,
    mainLocale,
    isSingleton
  );
}

function getUploadIdFromFieldValue(fieldValue: unknown, mainLocale: string): string | null {
  if (fieldValue === null || fieldValue === undefined) {
    return null;
  }

  const isFileValue = !Array.isArray(fieldValue) && hasUploadId(fieldValue);

  const resolvedValue = isFileValue ? fieldValue : extractLocalizedValue(fieldValue, mainLocale);

  if (!resolvedValue) {
    return null;
  }

  if (Array.isArray(resolvedValue)) {
    const firstAsset = resolvedValue[0];
    if (hasUploadId(firstAsset)) {
      return firstAsset.upload_id;
    }
    return null;
  }

  if (hasUploadId(resolvedValue)) {
    return resolvedValue.upload_id;
  }

  return null;
}

async function fetchThumbnailFromUpload(client: Client, uploadId: string): Promise<string | null> {
  try {
    const upload = await client.uploads.find(uploadId);
    const mimeType = upload.mime_type ?? '';
    const url = upload.url ?? '';
    return getThumbnailUrl(mimeType, url, upload.mux_playback_id);
  } catch (error) {
    logError('Failed to fetch thumbnail for upload:', error, { uploadId });
    return null;
  }
}

export async function extractRecordThumbnail(
  record: RecordWithAttributes,
  itemType: ItemTypeWithRelationships | undefined,
  fields: RecordField[],
  mainLocale: string,
  client: Client | null
): Promise<string | null> {
  if (!itemType || !client) {
    return null;
  }

  const isCompactView = itemType.attributes.collection_appearance === 'compact';
  if (isCompactView) {
    return null;
  }

  const presentationImageFieldId = itemType.relationships.presentation_image_field.data?.id;
  const imagePreviewFieldId = itemType.relationships.image_preview_field.data?.id;
  const imageFieldId = presentationImageFieldId ?? imagePreviewFieldId;

  if (imageFieldId) {
    const imageField = fields.find((f) => f.id === imageFieldId);
    if (imageField) {
      const fieldApiKey = imageField.attributes.api_key;
      const uploadId = getUploadIdFromFieldValue(record.attributes[fieldApiKey], mainLocale);
      if (uploadId) {
        const thumbnail = await fetchThumbnailFromUpload(client, uploadId);
        if (thumbnail) {
          return thumbnail;
        }
      }
    }
  }

  const sortedFields = [...fields].sort(
    (a, b) => (a.attributes.position ?? 0) - (b.attributes.position ?? 0)
  );
  const firstImageField = sortedFields.find((f) => {
    const fieldType = f.attributes.field_type;
    return fieldType === 'file' || fieldType === 'gallery';
  });

  if (firstImageField) {
    const fieldApiKey = firstImageField.attributes.api_key;
    const uploadId = getUploadIdFromFieldValue(record.attributes[fieldApiKey], mainLocale);
    if (uploadId) {
      return await fetchThumbnailFromUpload(client, uploadId);
    }
  }

  return null;
}

export async function createRecordMention(
  record: RecordWithAttributes,
  model: RecordPickerModelInfo,
  itemType: ItemTypeWithRelationships | undefined,
  fields: RecordField[],
  mainLocale: string,
  client: Client | null,
  modelEmojiOverride?: string | null
): Promise<RecordMention> {
  const isSingleton = itemType?.attributes.singleton ?? false;

  const recordTitle = extractRecordTitle(record, itemType, fields, model.name, mainLocale);
  const recordThumbnailUrl = await extractRecordThumbnail(record, itemType, fields, mainLocale, client);

  const modelEmoji: string | null = modelEmojiOverride !== undefined
    ? modelEmojiOverride
    : extractLeadingEmoji(model.name).emoji;

  return {
    type: 'record',
    id: record.id,
    title: recordTitle,
    modelId: model.id,
    modelApiKey: model.apiKey,
    modelName: model.name,
    modelEmoji,
    thumbnailUrl: recordThumbnailUrl,
    isSingleton,
  };
}
