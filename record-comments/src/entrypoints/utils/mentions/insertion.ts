import type {
  UserMention,
  FieldMention,
  AssetMention,
  RecordMention,
  ModelMention,
} from '@ctypes/mentions';
import { encodeFieldPath } from './fieldPathCodec';

/**
 * ============================================================================
 * ARCHITECTURAL NOTE: WHY THERE ARE NO insertAssetMention / insertRecordMention
 * ============================================================================
 *
 * This file provides insertion functions for different mention types:
 * - insertUserMention(@)  - creates mention from UserInsertData
 * - insertFieldMention(#) - creates mention from FieldInsertData
 * - insertModelMention($) - creates mention from ModelInsertData
 * - insertToolbarMention  - inserts pre-created mention at cursor (asset/record/model)
 *
 * You might notice the asymmetry: there's no `insertAssetMention` or `insertRecordMention`
 * that follows the same pattern as the other three. This is INTENTIONAL.
 *
 * WHY ASSET/RECORD MENTIONS ARE DIFFERENT:
 *
 * 1. USER/FIELD/MODEL MENTIONS use text triggers (@, #, $):
 *    - User types trigger character in text
 *    - Dropdown shows matching options
 *    - Selection replaces the trigger text with mention placeholder
 *    - These functions handle the trigger-start-to-cursor replacement
 *
 * 2. ASSET/RECORD MENTIONS use DatoCMS pickers (^, &):
 *    - User types trigger OR clicks toolbar button
 *    - DatoCMS picker modal opens (selectUpload, selectItem)
 *    - Picker returns full asset/record data directly
 *    - No trigger text to replace - just insert at cursor
 *    - The mention object is created in the calling code (usePageAssetMention, etc.)
 *
 * 3. insertToolbarMention HANDLES THE INSERTION:
 *    - Takes a pre-created AssetMention | RecordMention | ModelMention
 *    - Inserts at cursor position (no trigger start to track)
 *    - Used by toolbar buttons and after picker selection
 *
 * WHY NOT ADD SYMMETRIC FUNCTIONS ANYWAY?
 *
 * - Asset/record data comes from pickers with different shapes than our InsertData types
 * - Creating fake InsertData types would add indirection without benefit
 * - The calling code already has the full asset/record data from the picker
 * - Symmetry for its own sake adds complexity, not value
 *
 * IF YOU NEED TO ADD ASSET/RECORD INSERTION:
 * - Use insertToolbarMention with a pre-created mention object
 * - Create the mention in your hook/component where you have the picker result
 * - See usePageAssetMention.ts and usePageRecordMention.ts for examples
 *
 * ============================================================================
 */

export type UserInsertData = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export type FieldInsertData = {
  apiKey: string;
  label: string;
  localized: boolean;
  fieldPath: string;
  fieldType?: string;
};

export type ModelInsertData = {
  id: string;
  apiKey: string;
  name: string;
  isBlockModel: boolean;
};

export type InsertResult<T> = {
  newText: string;
  newCursorPosition: number;
  mention: T;
};

/**
 * Inserts a user mention at the trigger position.
 */
export function insertUserMention(
  text: string,
  triggerStartIndex: number,
  cursorPosition: number,
  user: UserInsertData
): InsertResult<UserMention> {
  const before = text.slice(0, triggerStartIndex);
  const after = text.slice(cursorPosition);

  const mentionText = `@${user.id} `;
  const newText = before + mentionText + after;
  const newCursorPosition = triggerStartIndex + mentionText.length;

  const mention: UserMention = {
    type: 'user',
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };

  return { newText, newCursorPosition, mention };
}

/**
 * Inserts a field mention at the trigger position.
 */
export function insertFieldMention(
  text: string,
  triggerStartIndex: number,
  cursorPosition: number,
  field: FieldInsertData,
  locale?: string
): InsertResult<FieldMention> {
  const before = text.slice(0, triggerStartIndex);
  const after = text.slice(cursorPosition);

  // Use centralized encoding (see fieldPathCodec.ts for format documentation)
  const encodedPath = encodeFieldPath(field.fieldPath);

  // Only add locale suffix if:
  // 1. locale is specified AND
  // 2. locale is not already embedded in the path (for nested fields in localized containers)
  // Check if the path already contains the locale (e.g., sections::it::0::hero_title already has "it")
  const localeAlreadyInPath = locale && encodedPath.includes(`::${locale}::`);
  const localeSuffix = locale && !localeAlreadyInPath ? `::${locale}` : '';
  const mentionText = `#${encodedPath}${localeSuffix} `;
  const newText = before + mentionText + after;
  const newCursorPosition = triggerStartIndex + mentionText.length;

  const mention: FieldMention = {
    type: 'field',
    apiKey: field.apiKey,
    label: field.label,
    localized: field.localized,
    fieldPath: field.fieldPath,
    locale,
    fieldType: field.fieldType,
  };

  return { newText, newCursorPosition, mention };
}

/**
 * Inserts a model mention at the trigger position.
 */
export function insertModelMention(
  text: string,
  triggerStartIndex: number,
  cursorPosition: number,
  model: ModelInsertData
): InsertResult<ModelMention> {
  const before = text.slice(0, triggerStartIndex);
  const after = text.slice(cursorPosition);

  const mentionText = `$${model.id} `;
  const newText = before + mentionText + after;
  const newCursorPosition = triggerStartIndex + mentionText.length;

  const mention: ModelMention = {
    type: 'model',
    id: model.id,
    apiKey: model.apiKey,
    name: model.name,
    isBlockModel: model.isBlockModel,
  };

  return { newText, newCursorPosition, mention };
}

/**
 * Inserts a toolbar mention (asset, record, or model) at the cursor position.
 */
export function insertToolbarMention(
  text: string,
  cursorPosition: number,
  mention: AssetMention | RecordMention | ModelMention
): { newText: string; newCursorPosition: number } {
  const before = text.slice(0, cursorPosition);
  const after = text.slice(cursorPosition);

  let mentionText: string;
  switch (mention.type) {
    case 'asset':
      mentionText = `^${mention.id} `;
      break;
    case 'record':
      mentionText = `&${mention.id} `;
      break;
    case 'model':
      mentionText = `$${mention.id} `;
      break;
  }

  const newText = before + mentionText + after;
  const newCursorPosition = cursorPosition + mentionText.length;

  return { newText, newCursorPosition };
}
