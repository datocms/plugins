import type {
  CommentSegment,
  Mention,
  MentionMapKey,
  UserMention,
  FieldMention,
  AssetMention,
  RecordMention,
  ModelMention,
} from '../types/mentions';
import { createMentionKey } from '../types/mentions';

/**
 * Decodes an encoded field path back to its original form.
 * Converts underscores back to dots for nested paths.
 * Uses heuristic: underscore followed by digit -> dot (e.g., blocks_0_heading -> blocks.0.heading)
 */
function decodeFieldPath(encodedPath: string): string {
  // Replace patterns like _0_, _1_, etc. with .0., .1., etc.
  // This handles block indices like blocks_0_heading -> blocks.0.heading
  return encodedPath.replace(/_(\d+)(?=_|$)/g, '.$1');
}

/**
 * Common locale codes to check for when parsing field mentions.
 */
const COMMON_LOCALES = ['en', 'it', 'de', 'fr', 'es', 'pt', 'nl', 'ja', 'zh', 'ko', 'ru', 'ar', 'pl', 'tr', 'sv', 'da', 'no', 'fi'];

/**
 * Finds a field mention in the mentions map, trying various key combinations.
 * Handles encoded paths with or without locale suffixes.
 */
function findFieldMention(
  encodedPath: string,
  mentionsMap: Map<MentionMapKey, Mention>
): Mention | undefined {
  // Strategy 1: Try exact match (for simple fields without locale)
  let key: MentionMapKey = `field:${encodedPath}`;
  let mention = mentionsMap.get(key);
  if (mention) return mention;

  // Strategy 2: Try decoding path (underscores to dots for nested paths)
  const decodedPath = decodeFieldPath(encodedPath);
  key = `field:${decodedPath}`;
  mention = mentionsMap.get(key);
  if (mention) return mention;

  // Strategy 3: Try extracting locale suffix from the encoded path
  // Locale is typically 2-3 chars at the end after an underscore (e.g., title_en, blocks_0_heading_pt)
  const lastUnderscoreIdx = encodedPath.lastIndexOf('_');
  if (lastUnderscoreIdx > 0) {
    const possibleLocale = encodedPath.slice(lastUnderscoreIdx + 1);
    
    // Check if it looks like a locale (2-5 chars, lowercase letters, possibly with hyphen)
    if (/^[a-z]{2}(-[a-z]{2})?$/i.test(possibleLocale) || COMMON_LOCALES.includes(possibleLocale.toLowerCase())) {
      const pathWithoutLocale = encodedPath.slice(0, lastUnderscoreIdx);
      
      // Try with locale suffix in the key
      key = `field:${pathWithoutLocale}.${possibleLocale}`;
      mention = mentionsMap.get(key);
      if (mention) return mention;

      // Try decoded path with locale
      const decodedPathWithoutLocale = decodeFieldPath(pathWithoutLocale);
      key = `field:${decodedPathWithoutLocale}.${possibleLocale}`;
      mention = mentionsMap.get(key);
      if (mention) return mention;
    }
  }

  return undefined;
}

/**
 * Converts CommentSegment[] to editable text for textarea.
 * Also populates a mentionsMap with the full mention data.
 * 
 * User mentions become: @userId
 * Field mentions become: #apiKey
 * Model mentions become: $modelId
 * Asset mentions become: ^assetId
 * Record mentions become: &recordId
 */
export function segmentsToEditableText(
  segments: CommentSegment[]
): { editableText: string; mentionsMap: Map<MentionMapKey, Mention> } {
  const mentionsMap = new Map<MentionMapKey, Mention>();
  let editableText = '';

  for (const segment of segments) {
    if (segment.type === 'text') {
      editableText += segment.content;
    } else {
      const { mention } = segment;
      const key = createMentionKey(mention);
      mentionsMap.set(key, mention);

      switch (mention.type) {
        case 'user':
          editableText += `@${mention.id}`;
          break;
        case 'field': {
          // Encode fieldPath: replace dots with underscores for text format
          // Fallback to apiKey for backwards compatibility with old mentions
          // If locale is specified, append it to the path
          const fieldPath = mention.fieldPath ?? mention.apiKey;
          const localeSuffix = mention.locale ? `_${mention.locale}` : '';
          editableText += `#${fieldPath.replace(/\./g, '_')}${localeSuffix}`;
          break;
        }
        case 'asset':
          editableText += `^${mention.id}`;
          break;
        case 'record':
          editableText += `&${mention.id}`;
          break;
        case 'model':
          editableText += `$${mention.id}`;
          break;
      }
    }
  }

  return { editableText, mentionsMap };
}

/**
 * Parses editable text back to CommentSegment[].
 * Looks up mention data from the provided mentionsMap.
 * 
 * Patterns detected:
 * - @userId (user mentions)
 * - #apiKey (field mentions)
 * - $modelId (model mentions)
 * - ^assetId (asset mentions)
 * - &recordId (record mentions)
 */
export function editableTextToSegments(
  text: string,
  mentionsMap: Map<MentionMapKey, Mention>
): CommentSegment[] {
  if (!text) return [];

  const segments: CommentSegment[] = [];

  // Combined regex to match all mention patterns
  // @userId, #fieldPath (with underscores), $modelId, ^assetId, &recordId
  // Field paths can contain letters, numbers, and underscores (dots are encoded as underscores)
  const mentionRegex = /@([a-zA-Z0-9_-]+)|#([a-z][a-z0-9_]*)|\$([a-zA-Z0-9_-]+)|\^([a-zA-Z0-9_-]+)|&([a-zA-Z0-9_-]+)/g;

  let lastIndex = 0;
  let match = mentionRegex.exec(text);

  while (match) {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }

    // Determine which pattern matched
    if (match[1] !== undefined) {
      // User mention: @userId
      const userId = match[1];
      const key: MentionMapKey = `user:${userId}`;
      const mention = mentionsMap.get(key);
      
      if (mention && mention.type === 'user') {
        segments.push({ type: 'mention', mention });
      } else {
        // No mention data found, keep as plain text
        segments.push({ type: 'text', content: match[0] });
      }
    } else if (match[2] !== undefined) {
      // Field mention: #fieldPath (underscores encode dots, may have locale suffix)
      const encodedPath = match[2];
      const mention = findFieldMention(encodedPath, mentionsMap);
      
      if (mention && mention.type === 'field') {
        segments.push({ type: 'mention', mention });
      } else {
        // No mention data found, keep as plain text
        segments.push({ type: 'text', content: match[0] });
      }
    } else if (match[3] !== undefined) {
      // Model mention: $modelId
      const modelId = match[3];
      const key: MentionMapKey = `model:${modelId}`;
      const mention = mentionsMap.get(key);
      
      if (mention && mention.type === 'model') {
        segments.push({ type: 'mention', mention });
      } else {
        // No mention data found, keep as plain text
        segments.push({ type: 'text', content: match[0] });
      }
    } else if (match[4] !== undefined) {
      // Asset mention: ^assetId
      const assetId = match[4];
      const key: MentionMapKey = `asset:${assetId}`;
      const mention = mentionsMap.get(key);
      
      if (mention && mention.type === 'asset') {
        segments.push({ type: 'mention', mention });
      } else {
        // No mention data found, keep as plain text
        segments.push({ type: 'text', content: match[0] });
      }
    } else if (match[5] !== undefined) {
      // Record mention: &recordId
      const recordId = match[5];
      const key: MentionMapKey = `record:${recordId}`;
      const mention = mentionsMap.get(key);
      
      if (mention && mention.type === 'record') {
        segments.push({ type: 'mention', mention });
      } else {
        // No mention data found, keep as plain text
        segments.push({ type: 'text', content: match[0] });
      }
    }

    lastIndex = match.index + match[0].length;
    match = mentionRegex.exec(text);
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

/**
 * Detects if the user is currently typing a mention trigger.
 * Returns the trigger type and query if found.
 */
export function detectActiveTrigger(
  text: string,
  cursorPosition: number
): { type: 'user' | 'field' | 'model' | 'asset' | 'record'; query: string; startIndex: number } | null {
  const textBeforeCursor = text.slice(0, cursorPosition);

  // Find the last @, #, $, ^, or & before cursor
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');
  const lastHashIndex = textBeforeCursor.lastIndexOf('#');
  const lastDollarIndex = textBeforeCursor.lastIndexOf('$');
  const lastCaretIndex = textBeforeCursor.lastIndexOf('^');
  const lastAmpersandIndex = textBeforeCursor.lastIndexOf('&');

  // Determine which trigger is more recent
  const lastTriggerIndex = Math.max(lastAtIndex, lastHashIndex, lastDollarIndex, lastCaretIndex, lastAmpersandIndex);
  if (lastTriggerIndex === -1) return null;

  let triggerType: 'user' | 'field' | 'model' | 'asset' | 'record';
  if (lastTriggerIndex === lastAtIndex) {
    triggerType = 'user';
  } else if (lastTriggerIndex === lastHashIndex) {
    triggerType = 'field';
  } else if (lastTriggerIndex === lastDollarIndex) {
    triggerType = 'model';
  } else if (lastTriggerIndex === lastCaretIndex) {
    triggerType = 'asset';
  } else {
    triggerType = 'record';
  }
  
  const textAfterTrigger = textBeforeCursor.slice(lastTriggerIndex + 1);

  // If there's a space after the trigger, the mention is complete/cancelled
  if (/\s/.test(textAfterTrigger)) return null;

  return {
    type: triggerType,
    query: textAfterTrigger.toLowerCase(),
    startIndex: lastTriggerIndex,
  };
}

/**
 * Inserts a user mention at the trigger position.
 */
export function insertUserMention(
  text: string,
  triggerStartIndex: number,
  cursorPosition: number,
  user: { id: string; name: string; email: string; avatarUrl: string | null }
): { newText: string; newCursorPosition: number; mention: UserMention } {
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
  field: { apiKey: string; label: string; localized: boolean; fieldPath: string; fieldType?: string },
  locale?: string
): { newText: string; newCursorPosition: number; mention: FieldMention } {
  const before = text.slice(0, triggerStartIndex);
  const after = text.slice(cursorPosition);

  // Encode fieldPath: replace dots with underscores for text format
  // If locale is specified, append it to the path
  const encodedPath = field.fieldPath.replace(/\./g, '_');
  const localeSuffix = locale ? `_${locale}` : '';
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

/**
 * Filters users based on a search query.
 */
export function filterUsers<T extends { name: string; email: string }>(
  users: T[],
  query: string
): T[] {
  const lowerQuery = query.toLowerCase();
  return users.filter(
    (user) =>
      user.name.toLowerCase().includes(lowerQuery) ||
      user.email.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Filters fields based on a search query.
 * Also filters on displayLabel for nested fields.
 */
export function filterFields<T extends { apiKey: string; label: string; displayLabel?: string }>(
  fields: T[],
  query: string
): T[] {
  const lowerQuery = query.toLowerCase();
  return fields.filter(
    (field) =>
      field.apiKey.toLowerCase().includes(lowerQuery) ||
      field.label.toLowerCase().includes(lowerQuery) ||
      field.displayLabel?.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Filters models based on a search query.
 */
export function filterModels<T extends { apiKey: string; name: string }>(
  models: T[],
  query: string
): T[] {
  const lowerQuery = query.toLowerCase();
  return models.filter(
    (model) =>
      model.apiKey.toLowerCase().includes(lowerQuery) ||
      model.name.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Inserts a model mention at the trigger position.
 */
export function insertModelMention(
  text: string,
  triggerStartIndex: number,
  cursorPosition: number,
  model: { id: string; apiKey: string; name: string; isBlockModel: boolean }
): { newText: string; newCursorPosition: number; mention: ModelMention } {
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




