import type { Mention, MentionType } from '@ctypes/mentions';
import {
  isValidUserMentionAttrs,
  isValidFieldMentionAttrs,
  isValidAssetMentionAttrs,
  isValidRecordMentionAttrs,
  isValidModelMentionAttrs,
} from './typeGuards';
import {
  applyFieldMentionDefaults,
  applyModelMentionDefaults,
} from './tiptapDefaults';
import { logWarn } from '@/utils/errorLogger';

/**
 * Converts raw node attributes to a typed Mention object.
 * Used by both TipTap serializer and MentionNodeView.
 */
export function attrsToMention(
  mentionType: MentionType,
  attrs: Record<string, unknown>
): Mention | null {
  switch (mentionType) {
    case 'user':
      if (!isValidUserMentionAttrs(attrs)) {
        logWarn('Invalid user mention attrs', { attrs });
        return null;
      }
      return {
        type: 'user',
        id: attrs.id,
        name: attrs.name,
        email: attrs.email,
        avatarUrl: attrs.avatarUrl,
      };

    case 'field':
      if (!isValidFieldMentionAttrs(attrs)) {
        logWarn('Invalid field mention attrs', { attrs });
        return null;
      }
      return {
        type: 'field',
        apiKey: attrs.apiKey,
        label: attrs.label,
        localized: applyFieldMentionDefaults.localized(attrs.localized),
        fieldPath: attrs.fieldPath,
        locale: attrs.locale ?? undefined,
        fieldType: attrs.fieldType ?? undefined,
      };

    case 'asset':
      if (!isValidAssetMentionAttrs(attrs)) {
        logWarn('Invalid asset mention attrs', { attrs });
        return null;
      }
      return {
        type: 'asset',
        id: attrs.id,
        filename: attrs.filename,
        url: attrs.url,
        thumbnailUrl: attrs.thumbnailUrl,
        mimeType: attrs.mimeType,
      };

    case 'record':
      if (!isValidRecordMentionAttrs(attrs)) {
        logWarn('Invalid record mention attrs', { attrs });
        return null;
      }
      return {
        type: 'record',
        id: attrs.id,
        title: attrs.title,
        modelId: attrs.modelId,
        modelApiKey: attrs.modelApiKey,
        modelName: attrs.modelName,
        modelEmoji: attrs.modelEmoji,
        thumbnailUrl: attrs.thumbnailUrl,
        isSingleton: attrs.isSingleton,
      };

    case 'model':
      if (!isValidModelMentionAttrs(attrs)) {
        logWarn('Invalid model mention attrs', { attrs });
        return null;
      }
      return {
        type: 'model',
        id: attrs.id,
        apiKey: attrs.apiKey,
        name: attrs.name,
        isBlockModel: applyModelMentionDefaults.isBlockModel(attrs.isBlockModel),
      };

    default:
      return null;
  }
}
