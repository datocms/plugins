import type { ApiTypes } from '@datocms/cma-client-browser';

export type SelectionGranularity = 'field_value' | 'exact_match';

export type DiscoveryWorkflow = 'text' | 'field_api_key' | 'browse';

export type PublicationStatus = 'draft' | 'updated' | 'published';

export type MatcherKind = 'literal' | 'regex';

export type MatcherSpec = {
  kind: MatcherKind;
  /** Never trimmed: leading and trailing spaces are part of the search. */
  pattern: string;
  caseSensitive: boolean;
  /**
   * Only match when no letter, mark, digit or underscore touches either end.
   * Required (not optional) so a serialized spec never differs between a
   * missing key and `undefined`.
   */
  wholeWord: boolean;
};

export type SearchableFieldType =
  | 'string'
  | 'text'
  | 'slug'
  | 'structured_text'
  | 'seo';

export type BrowseCoordinates = {
  rootModelId: string;
  recordId?: string;
};

/** Normalized, transport-safe description of a discovery run. */
export type DiscoverySpec = {
  granularity: SelectionGranularity;
  workflow: DiscoveryWorkflow;
  rootModelIds: string[];
  locales: string[];
  publicationStatuses: PublicationStatus[];
  fieldTypes?: SearchableFieldType[];
  apiKey?: string;
  browse?: BrowseCoordinates;
  matcher?: MatcherSpec;
};

export type ValuePath = ReadonlyArray<string | number>;

export type EmbeddedBlockKind =
  | 'modular_content'
  | 'single_block'
  | 'structured_text_block'
  | 'structured_text_inline_block';

/**
 * One concrete block on the route from the root record to a field value.
 * IDs are semantic; API keys and paths are relocation/display hints only.
 */
export type BlockAncestryEntry = {
  blockId: string;
  blockModelId: string;
  kind: EmbeddedBlockKind;
  parentFieldId: string;
  parentFieldApiKey: string;
  parentFieldValueId: string;
  locale: string | null;
  valuePath: ValuePath;
};

/** Atomic selectable field value, including empty and non-text values. */
export type FieldValueRef = {
  kind: 'field_value';
  siteId: string;
  environment: string;
  rootModelId: string;
  rootRecordId: string;
  rootRecordVersion: string | null;
  ownerModelId: string;
  ownerRecordId: string;
  fieldId: string;
  fieldApiKey: string;
  fieldType: ApiTypes.Field['field_type'];
  locale: string | null;
  blockAncestry: ReadonlyArray<BlockAncestryEntry>;
  /** Canonical IDs of selectable container fields, outermost first. */
  ancestorFieldValueIds: ReadonlyArray<string>;
  /** Absolute path from the hydrated root record to this value. */
  valuePath: ValuePath;
  present: boolean;
  valueFingerprint: string;
};

export type MatchContext = {
  before: string;
  match: string;
  after: string;
  beforeTruncated: boolean;
  afterTruncated: boolean;
};

/** UTF-16 offsets within the string at `path`, relative to the field value. */
export type TextFragment = {
  path: ValuePath;
  start: number;
  end: number;
};

/**
 * Capture groups of one regex match, in the order of the pattern. Present only
 * for regex matchers (and only when the pattern has groups); a group that did
 * not take part in the match is `null`.
 */
export type MatchCaptures = {
  captures?: ReadonlyArray<string | null>;
  namedCaptures?: Readonly<Record<string, string | null>>;
};

export type TextMatch = MatchCaptures & {
  occurrenceIndex: number;
  start: number;
  end: number;
  matchedText: string;
  context: MatchContext;
};

export type StructuredTextMatch = TextMatch & {
  flowPath: ValuePath;
  fragments: ReadonlyArray<TextFragment>;
};

/** Atomic selectable occurrence inside a text-compatible field value. */
export type ExactMatchRef = MatchCaptures & {
  kind: 'exact_match';
  fieldValue: FieldValueRef;
  matcherFingerprint: string;
  occurrenceIndex: number;
  matchedText: string;
  context: MatchContext;
  fragments: ReadonlyArray<TextFragment>;
};

export type SelectionTarget = FieldValueRef | ExactMatchRef;

export type SchemaModel = {
  id: string;
  name: string;
  apiKey: string;
  isBlockModel: boolean;
  raw: ApiTypes.ItemType;
};

export type SchemaField = {
  id: string;
  label: string;
  apiKey: string;
  fieldType: ApiTypes.Field['field_type'];
  localized: boolean;
  position: number;
  modelId: string;
  referencedBlockModelIds: ReadonlyArray<string>;
  exactMatchCompatible: boolean;
  raw: ApiTypes.Field;
};

export type ApiKeyCatalogLocation = {
  fieldId: string;
  fieldLabel: string;
  modelId: string;
  modelName: string;
  isBlockModel: boolean;
  fieldType: ApiTypes.Field['field_type'];
  localized: boolean;
  exactMatchCompatible: boolean;
  reachableRootModelIds: ReadonlyArray<string>;
};

export type ApiKeyCatalogEntry = {
  apiKey: string;
  label: string;
  locations: ReadonlyArray<ApiKeyCatalogLocation>;
  rootModelIds: ReadonlyArray<string>;
  blockModelIds: ReadonlyArray<string>;
  reachableRootModelIds: ReadonlyArray<string>;
  fieldTypes: ReadonlyArray<ApiTypes.Field['field_type']>;
  localized: boolean | 'mixed';
  modelCount: number;
  blockModelCount: number;
  exactMatchCompatible: boolean;
  incompatibleLocationCount: number;
};

export type SchemaIndex = {
  modelsById: ReadonlyMap<string, SchemaModel>;
  fieldsById: ReadonlyMap<string, SchemaField>;
  fieldsByModelId: ReadonlyMap<string, ReadonlyArray<SchemaField>>;
  rootModelIds: ReadonlyArray<string>;
  blockModelIds: ReadonlyArray<string>;
  blockModelIdsByParentModelId: ReadonlyMap<string, ReadonlySet<string>>;
  reachableRootModelIdsByBlockModelId: ReadonlyMap<string, ReadonlySet<string>>;
  apiKeyCatalog: ReadonlyArray<ApiKeyCatalogEntry>;
  apiKeyCatalogByKey: ReadonlyMap<string, ApiKeyCatalogEntry>;
};

export type TraversedFieldValue = {
  ref: FieldValueRef;
  value: unknown;
  field: SchemaField;
  owner: {
    id: string;
    modelId: string;
  };
  isContainer: boolean;
};

export type MatcherValidationErrorCode =
  | 'empty_pattern'
  | 'invalid_regex'
  | 'zero_width';

export type MatcherValidation =
  | { valid: true }
  | {
      valid: false;
      code: MatcherValidationErrorCode;
      message: string;
      /**
       * The regex parser's short reason ("unterminated group"), first letter
       * lowercased; null when unavailable or longer than 40 characters.
       */
      cause: string | null;
    };
