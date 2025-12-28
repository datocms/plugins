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

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is an object with an upload_id property.
 * Uses proper property checking without unsafe type assertions.
 *
 * NOTE: After the 'upload_id' in value check, TypeScript knows value is an object
 * with the upload_id property, allowing safe property access.
 */
function hasUploadId(value: unknown): value is { upload_id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'upload_id' in value &&
    typeof value.upload_id === 'string'
  );
}

/**
 * Item type with relationships for title and image fields
 */
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

/**
 * Field type for record field operations
 */
type RecordField = {
  id: string;
  attributes: {
    api_key: string;
    position?: number;
    field_type: string;
  };
};

/**
 * Record with attributes
 */
type RecordWithAttributes = {
  id: string;
  attributes: Record<string, unknown>;
};

/**
 * Model info for record picker
 */
export type RecordPickerModelInfo = {
  id: string;
  apiKey: string;
  name: string;
  isBlockModel: boolean;
};

/**
 * Extracts a title from a record based on its item type configuration.
 * Uses the shared extractTitleFromRecordData function to avoid duplication.
 */
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

  // Normalize the title field config from relationships structure
  const titleFieldConfig: TitleFieldConfig = {
    presentationTitleFieldId: itemType.relationships.presentation_title_field.data?.id ?? null,
    titleFieldId: itemType.relationships.title_field.data?.id ?? null,
  };

  // Normalize fields from attributes structure
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

/**
 * Gets the upload ID from a field value (handles both localized and non-localized).
 */
function getUploadIdFromFieldValue(fieldValue: unknown, mainLocale: string): string | null {
  if (fieldValue === null || fieldValue === undefined) {
    return null;
  }

  // Use the shared utility to extract localized value
  // Only extract locale if the value is not already a file value (has upload_id)
  const isFileValue = !Array.isArray(fieldValue) && hasUploadId(fieldValue);

  const resolvedValue = isFileValue ? fieldValue : extractLocalizedValue(fieldValue, mainLocale);

  if (!resolvedValue) {
    return null;
  }

  // Handle gallery (array of assets)
  if (Array.isArray(resolvedValue)) {
    const firstAsset = resolvedValue[0];
    if (hasUploadId(firstAsset)) {
      return firstAsset.upload_id;
    }
    return null;
  }

  // Handle single file
  if (hasUploadId(resolvedValue)) {
    return resolvedValue.upload_id;
  }

  return null;
}

/**
 * Fetches thumbnail URL from an upload ID.
 */
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

/**
 * Extracts a thumbnail URL from a record based on its item type configuration.
 */
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

  // Skip thumbnail extraction for compact view models
  const isCompactView = itemType.attributes.collection_appearance === 'compact';
  if (isCompactView) {
    return null;
  }

  // Try presentation image field first
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

  // Fallback: find first file/gallery field
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

/**
 * Creates a record mention from a selected record.
 */
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

  // Use override emoji if explicitly provided (including null to suppress emoji),
  // otherwise extract from model name. The explicit null case allows callers to
  // intentionally suppress the emoji display.
  const modelEmoji: string | null = modelEmojiOverride !== undefined
    ? modelEmojiOverride  // Handles both string and null cases explicitly
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
