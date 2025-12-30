import type {
  UserMention,
  FieldMention,
  AssetMention,
  RecordMention,
  ModelMention,
} from '@ctypes/mentions';
import { encodeFieldPath } from './fieldPathCodec';

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

export function insertFieldMention(
  text: string,
  triggerStartIndex: number,
  cursorPosition: number,
  field: FieldInsertData,
  locale?: string
): InsertResult<FieldMention> {
  const before = text.slice(0, triggerStartIndex);
  const after = text.slice(cursorPosition);

  const encodedPath = encodeFieldPath(field.fieldPath);

  // Skip locale suffix if already embedded in path (nested fields in localized containers)
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
