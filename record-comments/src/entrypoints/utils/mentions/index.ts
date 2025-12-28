// Field path encoding/decoding utilities
export {
  BLOCK_INDEX_PATTERN,
  COMMON_LOCALES,
  LOCALE_CODE_PATTERN,
  decodeFieldPath,
  looksLikeLocaleCode,
  findFieldMention,
} from './fieldPathCodec';

// Trigger detection
export { detectActiveTrigger } from './detection';
export type { TriggerType, TriggerInfo } from './detection';

// Mention insertion
export {
  insertUserMention,
  insertFieldMention,
  insertModelMention,
  insertToolbarMention,
} from './insertion';
export type {
  UserInsertData,
  FieldInsertData,
  ModelInsertData,
  InsertResult,
} from './insertion';

// Search/filtering
export { filterUsers, filterFields, filterModels } from './filters';
