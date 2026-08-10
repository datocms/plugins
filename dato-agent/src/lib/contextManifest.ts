import type { Field, ItemType } from 'datocms-plugin-sdk';

export const DEFAULT_HINT_CHARACTER_LIMIT = 160;
export const DEFAULT_OPTION_LIMIT = 20;
export const DEFAULT_PROJECT_MAP_CHARACTER_LIMIT = 6_000;

const MINIMUM_PROJECT_MAP_CHARACTER_LIMIT = 96;
const FIELD_DIRECTORY_TARGET_LIMIT = 8;

const PRESENTATION_ROLE_RELATIONSHIPS = {
  title_field: 'title',
  presentation_title_field: 'presentation_title',
  presentation_image_field: 'presentation_image',
  image_preview_field: 'image_preview',
  excerpt_field: 'excerpt',
  ordering_field: 'ordering',
} as const;

const TARGET_VALIDATORS = {
  item_item_type: 'records',
  items_item_type: 'records',
  rich_text_blocks: 'blocks',
  single_block_blocks: 'blocks',
  structured_text_blocks: 'blocks',
  structured_text_inline_blocks: 'inline_blocks',
  structured_text_links: 'linked_records',
} as const;

const SELECTED_VALIDATOR_PARAMETERS: Readonly<
  Record<string, readonly string[]>
> = {
  length: ['min', 'eq', 'max'],
  size: ['min', 'eq', 'max', 'multiple_of'],
  number_range: ['min', 'max'],
  date_range: ['min', 'max'],
  date_time_range: ['min', 'max'],
  enum: ['values'],
  format: ['predefined_pattern', 'custom_pattern', 'description'],
  slug_format: ['predefined_pattern', 'custom_pattern'],
  required_alt_title: ['title', 'alt'],
  required_seo_fields: ['title', 'description', 'image', 'twitter_card'],
  title_length: ['min', 'max'],
  description_length: ['min', 'max'],
  extension: ['extensions', 'predefined_list'],
  file_size: ['min_value', 'min_unit', 'max_value', 'max_unit'],
  image_dimensions: [
    'width_min_value',
    'width_max_value',
    'height_min_value',
    'height_max_value',
  ],
  image_aspect_ratio: [
    'min_ar_numerator',
    'min_ar_denominator',
    'eq_ar_numerator',
    'eq_ar_denominator',
    'max_ar_numerator',
    'max_ar_denominator',
  ],
  sanitized_html: ['sanitize_before_validation'],
  item_item_type: [
    'on_publish_with_unpublished_references_strategy',
    'on_reference_unpublish_strategy',
    'on_reference_delete_strategy',
  ],
  items_item_type: [
    'on_publish_with_unpublished_references_strategy',
    'on_reference_unpublish_strategy',
    'on_reference_delete_strategy',
  ],
  structured_text_links: [
    'on_publish_with_unpublished_references_strategy',
    'on_reference_unpublish_strategy',
    'on_reference_delete_strategy',
  ],
};

const SEMANTIC_BUILT_IN_EDITORS = new Set([
  'markdown',
  'wysiwyg',
  'textarea',
  'string_select',
  'string_radio_group',
  'string_multi_select',
  'string_checkbox_group',
  'structured_text',
  'slug',
  'seo',
]);

const ALL_BUILT_IN_EDITORS = new Set([
  'boolean',
  'boolean_radio_group',
  'color_picker',
  'date_picker',
  'date_time_picker',
  'file',
  'float',
  'framed_single_block',
  'frameless_single_block',
  'gallery',
  'integer',
  'json',
  'link_embed',
  'link_select',
  'links_embed',
  'links_select',
  'map',
  'markdown',
  'rich_text',
  'seo',
  'single_line',
  'slug',
  'string_checkbox_group',
  'string_multi_select',
  'string_radio_group',
  'string_select',
  'structured_text',
  'textarea',
  'video',
  'wysiwyg',
]);

export type PresentationRole =
  (typeof PRESENTATION_ROLE_RELATIONSHIPS)[keyof typeof PRESENTATION_ROLE_RELATIONSHIPS];

export type TargetKind =
  (typeof TARGET_VALIDATORS)[keyof typeof TARGET_VALIDATORS];

export type CappedText = {
  value: string;
  truncated: boolean;
};

export type CompactList = {
  values: string[];
  omittedCount: number;
};

export type CompactValidatorParameter = boolean | number | string | CompactList;

export type SelectedValidatorManifest = {
  code: string;
  parameters: Record<string, CompactValidatorParameter>;
};

export type TargetManifest = {
  apiKeys: string[];
  unresolvedIds: string[];
};

export type EditorOptionManifest = {
  value: string;
  label?: string;
};

export type EditorManifest = {
  kind: string;
  fieldExtension?: string;
  options?: EditorOptionManifest[];
  omittedOptionCount?: number;
  nodes?: CompactList;
  marks?: CompactList;
  headingLevels?: number[];
  visibleFields?: CompactList;
  urlPrefix?: CappedText;
};

export type FieldContextManifest = {
  id: string;
  apiKey: string;
  label: string;
  fieldType: Field['attributes']['field_type'];
  localized: boolean;
  required: boolean;
  unique: boolean;
  roles: PresentationRole[];
  hint?: CappedText;
  targets?: Partial<Record<TargetKind, TargetManifest>>;
  validators?: SelectedValidatorManifest[];
  editor?: EditorManifest;
};

export type ModelContextManifest = {
  id: string;
  apiKey: string;
  name: string;
  kind: 'model' | 'block';
  singleton: boolean;
  allLocalesRequired: boolean;
  draftModeActive: boolean;
  draftSavingActive: boolean;
  sortable: boolean;
  tree: boolean;
  workflowId?: string;
  hint?: CappedText;
  fieldsComplete: boolean;
  omittedFieldIds: string[];
  fields: FieldContextManifest[];
};

export type ManifestBuildOptions = {
  maxHintCharacters?: number;
  maxOptionValues?: number;
};

export type BuildModelContextManifestInput = ManifestBuildOptions & {
  itemType: ItemType;
  itemTypes: readonly ItemType[];
  fields: readonly Field[];
};

export type BuildStandaloneProjectMapInput = ManifestBuildOptions & {
  itemTypes: readonly ItemType[];
  fields: readonly Field[];
  maxCharacters?: number;
};

export type BuildStandaloneFieldDirectoryInput = ManifestBuildOptions & {
  itemTypes: readonly ItemType[];
  fields: readonly Field[];
  maxCharacters?: number;
};

export type StandaloneProjectMap = {
  text: string;
  characterCount: number;
  maxCharacters: number;
  complete: boolean;
  includedModelApiKeys: string[];
  omittedModelApiKeys: string[];
  sourceIncompleteModelApiKeys: string[];
};

export type StandaloneFieldDirectory = StandaloneProjectMap;

type NormalizedOptions = {
  maxHintCharacters: number;
  maxOptionValues: number;
};

function normalizeLimit(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;

  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError('Manifest limits must be non-negative integers.');
  }

  return result;
}

function normalizeOptions(options: ManifestBuildOptions): NormalizedOptions {
  return {
    maxHintCharacters: normalizeLimit(
      options.maxHintCharacters,
      DEFAULT_HINT_CHARACTER_LIMIT,
    ),
    maxOptionValues: normalizeLimit(
      options.maxOptionValues,
      DEFAULT_OPTION_LIMIT,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capText(value: string, maxCharacters: number): CappedText {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const characters = Array.from(normalized);

  if (characters.length <= maxCharacters) {
    return { value: normalized, truncated: false };
  }

  if (maxCharacters === 0) {
    return { value: '', truncated: true };
  }

  const suffix = maxCharacters === 1 ? '' : '…';
  const keptCharacters = maxCharacters - (suffix ? 1 : 0);

  return {
    value: `${characters.slice(0, keptCharacters).join('')}${suffix}`,
    truncated: true,
  };
}

function cappedOptionalText(
  value: string | null | undefined,
  maxCharacters: number,
): CappedText | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  return capText(value, maxCharacters);
}

function compactStringList(value: unknown, limit: number): CompactList | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const allValues = value.filter(
    (entry): entry is string => typeof entry === 'string',
  );

  return {
    values: allValues.slice(0, limit),
    omittedCount: Math.max(0, allValues.length - limit),
  };
}

function compactValidatorParameter(
  value: unknown,
  optionLimit: number,
): CompactValidatorParameter | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return compactStringList(value, optionLimit) ?? undefined;
}

function extractSelectedValidators(
  validators: Record<string, unknown>,
  optionLimit: number,
): SelectedValidatorManifest[] {
  const result: SelectedValidatorManifest[] = [];

  for (const [code, selectedKeys] of Object.entries(
    SELECTED_VALIDATOR_PARAMETERS,
  )) {
    const rawValidator = validators[code];

    if (!isRecord(rawValidator)) {
      continue;
    }

    const parameters: Record<string, CompactValidatorParameter> = {};

    for (const key of selectedKeys) {
      const value = compactValidatorParameter(rawValidator[key], optionLimit);

      if (value !== undefined) {
        parameters[key] = value;
      }
    }

    if (Object.keys(parameters).length > 0) {
      result.push({ code, parameters });
    }
  }

  return result;
}

function resolveTargetManifest(
  rawValidator: unknown,
  itemTypesById: ReadonlyMap<string, ItemType>,
): TargetManifest | null {
  if (!isRecord(rawValidator) || !Array.isArray(rawValidator.item_types)) {
    return null;
  }

  const apiKeys = new Set<string>();
  const unresolvedIds = new Set<string>();

  for (const value of rawValidator.item_types) {
    if (typeof value !== 'string') {
      continue;
    }

    const itemType = itemTypesById.get(value);

    if (itemType) {
      apiKeys.add(itemType.attributes.api_key);
    } else {
      unresolvedIds.add(value);
    }
  }

  return {
    apiKeys: [...apiKeys].sort(),
    unresolvedIds: [...unresolvedIds].sort(),
  };
}

function extractTargets(
  validators: Record<string, unknown>,
  itemTypesById: ReadonlyMap<string, ItemType>,
): Partial<Record<TargetKind, TargetManifest>> | undefined {
  const targets: Partial<Record<TargetKind, TargetManifest>> = {};

  for (const [validatorCode, targetKind] of Object.entries(TARGET_VALIDATORS)) {
    const target = resolveTargetManifest(
      validators[validatorCode],
      itemTypesById,
    );

    if (!target) {
      continue;
    }

    const existing = targets[targetKind];

    targets[targetKind] = existing
      ? {
          apiKeys: [
            ...new Set([...existing.apiKeys, ...target.apiKeys]),
          ].sort(),
          unresolvedIds: [
            ...new Set([...existing.unresolvedIds, ...target.unresolvedIds]),
          ].sort(),
        }
      : target;
  }

  return Object.keys(targets).length > 0 ? targets : undefined;
}

function readEditorOptions(
  parameters: Record<string, unknown>,
  editor: string,
  options: NormalizedOptions,
): Pick<EditorManifest, 'options' | 'omittedOptionCount'> {
  const rawOptions =
    editor === 'string_radio_group' ? parameters.radios : parameters.options;

  if (!Array.isArray(rawOptions)) {
    return {};
  }

  const parsedOptions: EditorOptionManifest[] = [];

  for (const rawOption of rawOptions) {
    if (!isRecord(rawOption) || typeof rawOption.value !== 'string') {
      continue;
    }

    parsedOptions.push({
      value: rawOption.value,
      ...(typeof rawOption.label === 'string'
        ? {
            label: capText(rawOption.label, options.maxHintCharacters).value,
          }
        : {}),
    });
  }

  return {
    options: parsedOptions.slice(0, options.maxOptionValues),
    omittedOptionCount: Math.max(
      0,
      parsedOptions.length - options.maxOptionValues,
    ),
  };
}

function extractSemanticEditor(
  field: Field,
  options: NormalizedOptions,
): EditorManifest | undefined {
  const appearance = field.attributes.appearance;
  const editor = appearance.editor;
  const parameters = appearance.parameters as Record<string, unknown>;

  if (!ALL_BUILT_IN_EDITORS.has(editor)) {
    return {
      kind: 'custom',
      ...(appearance.field_extension
        ? { fieldExtension: appearance.field_extension }
        : {}),
    };
  }

  if (!SEMANTIC_BUILT_IN_EDITORS.has(editor)) {
    return undefined;
  }

  const manifest: EditorManifest = { kind: editor };

  if (
    editor === 'string_select' ||
    editor === 'string_radio_group' ||
    editor === 'string_multi_select' ||
    editor === 'string_checkbox_group'
  ) {
    Object.assign(manifest, readEditorOptions(parameters, editor, options));
  }

  if (editor === 'structured_text') {
    manifest.nodes =
      compactStringList(parameters.nodes, options.maxOptionValues) ?? undefined;
    manifest.marks =
      compactStringList(parameters.marks, options.maxOptionValues) ?? undefined;

    if (Array.isArray(parameters.heading_levels)) {
      manifest.headingLevels = parameters.heading_levels.filter(
        (value): value is number => typeof value === 'number',
      );
    }
  }

  if (editor === 'seo') {
    manifest.visibleFields =
      compactStringList(parameters.fields, options.maxOptionValues) ??
      undefined;
  }

  if (editor === 'slug' && typeof parameters.url_prefix === 'string') {
    manifest.urlPrefix = capText(
      parameters.url_prefix,
      options.maxHintCharacters,
    );
  }

  return manifest;
}

function presentationRolesByFieldId(
  itemType: ItemType,
): ReadonlyMap<string, PresentationRole[]> {
  const rolesByFieldId = new Map<string, PresentationRole[]>();

  for (const [relationshipName, role] of Object.entries(
    PRESENTATION_ROLE_RELATIONSHIPS,
  )) {
    const relationship =
      itemType.relationships[
        relationshipName as keyof typeof PRESENTATION_ROLE_RELATIONSHIPS
      ];
    const fieldId = relationship.data?.id;

    if (!fieldId) {
      continue;
    }

    const roles = rolesByFieldId.get(fieldId) ?? [];
    roles.push(role);
    rolesByFieldId.set(fieldId, roles);
  }

  return rolesByFieldId;
}

function buildFieldContextManifest(
  field: Field,
  itemTypesById: ReadonlyMap<string, ItemType>,
  roles: readonly PresentationRole[],
  options: NormalizedOptions,
): FieldContextManifest {
  const validators = field.attributes.validators as Record<string, unknown>;
  const selectedValidators = extractSelectedValidators(
    validators,
    options.maxOptionValues,
  );
  const hint = cappedOptionalText(
    field.attributes.hint,
    options.maxHintCharacters,
  );
  const targets = extractTargets(validators, itemTypesById);
  const editor = extractSemanticEditor(field, options);

  return {
    id: field.id,
    apiKey: field.attributes.api_key,
    label: field.attributes.label,
    fieldType: field.attributes.field_type,
    localized: field.attributes.localized,
    required: isRecord(validators.required),
    unique: isRecord(validators.unique),
    roles: [...roles].sort(),
    ...(hint ? { hint } : {}),
    ...(targets ? { targets } : {}),
    ...(selectedValidators.length > 0
      ? { validators: selectedValidators }
      : {}),
    ...(editor ? { editor } : {}),
  };
}

export function buildModelContextManifest({
  itemType,
  itemTypes,
  fields,
  ...rawOptions
}: BuildModelContextManifestInput): ModelContextManifest {
  const options = normalizeOptions(rawOptions);
  const itemTypesById = new Map(
    itemTypes.map((candidate) => [candidate.id, candidate]),
  );
  itemTypesById.set(itemType.id, itemType);

  const fieldsById = new Map(
    fields
      .filter((field) => field.relationships.item_type.data.id === itemType.id)
      .map((field) => [field.id, field]),
  );
  const expectedFieldIds = itemType.relationships.fields.data.map(
    (field) => field.id,
  );
  const omittedFieldIds = expectedFieldIds.filter(
    (fieldId) => !fieldsById.has(fieldId),
  );
  const rolesByFieldId = presentationRolesByFieldId(itemType);
  const modelFields = expectedFieldIds
    .map((fieldId) => fieldsById.get(fieldId))
    .filter((field): field is Field => Boolean(field))
    .sort(
      (left, right) =>
        left.attributes.position - right.attributes.position ||
        left.attributes.api_key.localeCompare(right.attributes.api_key),
    )
    .map((field) =>
      buildFieldContextManifest(
        field,
        itemTypesById,
        rolesByFieldId.get(field.id) ?? [],
        options,
      ),
    );
  const hint = cappedOptionalText(
    itemType.attributes.hint,
    options.maxHintCharacters,
  );

  return {
    id: itemType.id,
    apiKey: itemType.attributes.api_key,
    name: itemType.attributes.name,
    kind: itemType.attributes.modular_block ? 'block' : 'model',
    singleton: itemType.attributes.singleton,
    allLocalesRequired: itemType.attributes.all_locales_required,
    draftModeActive: itemType.attributes.draft_mode_active,
    draftSavingActive: itemType.attributes.draft_saving_active,
    sortable: itemType.attributes.sortable,
    tree: itemType.attributes.tree,
    ...(itemType.relationships.workflow.data
      ? { workflowId: itemType.relationships.workflow.data.id }
      : {}),
    ...(hint ? { hint } : {}),
    fieldsComplete: omittedFieldIds.length === 0,
    omittedFieldIds,
    fields: modelFields,
  };
}

function renderCompactList(list: CompactList): string {
  const omitted = list.omittedCount > 0 ? `,+${list.omittedCount}` : '';
  return `[${list.values.map((value) => JSON.stringify(value)).join(',')}${omitted}]`;
}

function renderValidatorParameter(
  parameter: CompactValidatorParameter,
): string {
  return isRecord(parameter)
    ? renderCompactList(parameter as CompactList)
    : JSON.stringify(parameter);
}

function renderTarget(target: TargetManifest): string {
  return [...target.apiKeys, ...target.unresolvedIds.map((id) => `id:${id}`)]
    .map((value) => JSON.stringify(value))
    .join(',');
}

function renderEditor(editor: EditorManifest): string {
  const details: string[] = [editor.kind];

  if (editor.fieldExtension) {
    details.push(`extension=${JSON.stringify(editor.fieldExtension)}`);
  }

  if (editor.options) {
    const omitted =
      editor.omittedOptionCount && editor.omittedOptionCount > 0
        ? `,+${editor.omittedOptionCount}`
        : '';
    details.push(
      `options=[${editor.options
        .map((option) =>
          option.label
            ? `${JSON.stringify(option.value)}:${JSON.stringify(option.label)}`
            : JSON.stringify(option.value),
        )
        .join(',')}${omitted}]`,
    );
  }

  if (editor.nodes) {
    details.push(`nodes=${renderCompactList(editor.nodes)}`);
  }

  if (editor.marks) {
    details.push(`marks=${renderCompactList(editor.marks)}`);
  }

  if (editor.headingLevels) {
    details.push(`headings=${editor.headingLevels.join(',')}`);
  }

  if (editor.visibleFields) {
    details.push(`fields=${renderCompactList(editor.visibleFields)}`);
  }

  if (editor.urlPrefix) {
    details.push(`prefix=${JSON.stringify(editor.urlPrefix.value)}`);
  }

  return details.join(';');
}

function renderFieldManifest(field: FieldContextManifest): string {
  const details: string[] = [
    `field ${field.apiKey}`,
    JSON.stringify(field.label),
    field.fieldType,
  ];

  if (field.localized) {
    details.push('localized');
  }

  if (field.required) {
    details.push('required');
  }

  if (field.unique) {
    details.push('unique');
  }

  if (field.roles.length > 0) {
    details.push(`roles=${field.roles.join(',')}`);
  }

  if (field.targets) {
    const targets = Object.entries(field.targets)
      .map(([kind, target]) => `${kind}=[${renderTarget(target)}]`)
      .join(';');
    details.push(`targets=${targets}`);
  }

  if (field.validators) {
    const validators = field.validators
      .map(
        (validator) =>
          `${validator.code}(${Object.entries(validator.parameters)
            .map(([key, value]) => `${key}=${renderValidatorParameter(value)}`)
            .join(',')})`,
      )
      .join(';');
    details.push(`validators=${validators}`);
  }

  if (field.editor) {
    details.push(`editor=${renderEditor(field.editor)}`);
  }

  if (field.hint) {
    details.push(`hint=${JSON.stringify(field.hint.value)}`);
  }

  return details.join('|');
}

export function renderModelContextManifest(
  manifest: ModelContextManifest,
): string {
  const flags = [
    manifest.singleton ? 'singleton' : null,
    manifest.allLocalesRequired ? 'all_locales_required' : null,
    manifest.draftModeActive ? 'draft_mode' : null,
    manifest.draftSavingActive ? 'draft_saving' : null,
    manifest.sortable ? 'sortable' : null,
    manifest.tree ? 'tree' : null,
    manifest.workflowId ? `workflow:${manifest.workflowId}` : null,
  ].filter((flag): flag is string => Boolean(flag));
  const header = [
    `model ${manifest.apiKey}`,
    JSON.stringify(manifest.name),
    `id=${manifest.id}`,
    `kind=${manifest.kind}`,
    `fields_complete=${manifest.fieldsComplete}`,
    `fields=${manifest.fields.length}`,
    `omitted_fields=${manifest.omittedFieldIds.length}`,
    ...(flags.length > 0 ? [`flags=${flags.join(',')}`] : []),
    ...(manifest.hint ? [`hint=${JSON.stringify(manifest.hint.value)}`] : []),
  ].join('|');
  const missingFields =
    manifest.omittedFieldIds.length > 0
      ? `missing_field_ids=${manifest.omittedFieldIds.join(',')}`
      : null;

  return [header, missingFields, ...manifest.fields.map(renderFieldManifest)]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function renderProjectMap(
  manifests: readonly ModelContextManifest[],
  totalModelCount: number,
  sourceIncompleteModelCount: number,
): string {
  const complete =
    manifests.length === totalModelCount && sourceIncompleteModelCount === 0;
  const header = [
    'project_map',
    `complete=${complete}`,
    `models=${manifests.length}/${totalModelCount}`,
    `omitted_models=${totalModelCount - manifests.length}`,
    `source_incomplete_models=${sourceIncompleteModelCount}`,
  ].join('|');

  return [header, ...manifests.map(renderModelContextManifest)].join('\n');
}

export function buildStandaloneProjectMap({
  itemTypes,
  fields,
  maxCharacters: rawMaxCharacters,
  ...rawOptions
}: BuildStandaloneProjectMapInput): StandaloneProjectMap {
  const maxCharacters = normalizeLimit(
    rawMaxCharacters,
    DEFAULT_PROJECT_MAP_CHARACTER_LIMIT,
  );

  if (maxCharacters < MINIMUM_PROJECT_MAP_CHARACTER_LIMIT) {
    throw new RangeError(
      `Project map maxCharacters must be at least ${MINIMUM_PROJECT_MAP_CHARACTER_LIMIT}.`,
    );
  }

  const sortedItemTypes = [...itemTypes].sort(
    (left, right) =>
      Number(left.attributes.modular_block) -
        Number(right.attributes.modular_block) ||
      left.attributes.api_key.localeCompare(right.attributes.api_key),
  );
  const manifests = sortedItemTypes.map((itemType) =>
    buildModelContextManifest({
      itemType,
      itemTypes: sortedItemTypes,
      fields,
      ...rawOptions,
    }),
  );
  const sourceIncompleteModelApiKeys = manifests
    .filter((manifest) => !manifest.fieldsComplete)
    .map((manifest) => manifest.apiKey);
  const included: ModelContextManifest[] = [];
  const omitted: ModelContextManifest[] = [];

  for (const manifest of manifests) {
    const candidate = renderProjectMap(
      [...included, manifest],
      manifests.length,
      sourceIncompleteModelApiKeys.length,
    );

    if (candidate.length <= maxCharacters) {
      included.push(manifest);
    } else {
      omitted.push(manifest);
    }
  }

  const text = renderProjectMap(
    included,
    manifests.length,
    sourceIncompleteModelApiKeys.length,
  );

  if (text.length > maxCharacters) {
    throw new RangeError(
      'Project map maxCharacters is too small for completeness metadata.',
    );
  }

  return {
    text,
    characterCount: text.length,
    maxCharacters,
    complete: omitted.length === 0 && sourceIncompleteModelApiKeys.length === 0,
    includedModelApiKeys: included.map((manifest) => manifest.apiKey),
    omittedModelApiKeys: omitted.map((manifest) => manifest.apiKey),
    sourceIncompleteModelApiKeys,
  };
}

function renderFieldDirectoryTargets(
  targets: NonNullable<FieldContextManifest['targets']>,
): string {
  return Object.entries(targets)
    .map(([kind, target]) => {
      const identifiers = [
        ...target.apiKeys,
        ...target.unresolvedIds.map((id) => `id:${id}`),
      ];
      const includedIdentifiers = identifiers.slice(
        0,
        FIELD_DIRECTORY_TARGET_LIMIT,
      );
      const omittedCount = Math.max(
        0,
        identifiers.length - includedIdentifiers.length,
      );

      return identifiers.length > 0
        ? `${kind}=${includedIdentifiers.join(',')}${
            omittedCount > 0 ? `,+${omittedCount}` : ''
          }`
        : null;
    })
    .filter((target): target is string => Boolean(target))
    .join(';');
}

function renderFieldDirectoryModel(manifest: ModelContextManifest): string {
  const fieldsByType: Record<string, string[]> = {};
  const localizedFields: string[] = [];
  const fieldRoles: Record<string, PresentationRole[]> = {};
  const fieldTargets: Record<string, string> = {};

  for (const field of manifest.fields) {
    const fieldsOfType = fieldsByType[field.fieldType] ?? [];
    fieldsOfType.push(field.apiKey);
    fieldsByType[field.fieldType] = fieldsOfType;

    if (field.localized) {
      localizedFields.push(field.apiKey);
    }

    if (field.roles.length > 0) {
      fieldRoles[field.apiKey] = field.roles;
    }

    if (field.targets) {
      const targets = renderFieldDirectoryTargets(field.targets);

      if (targets) {
        fieldTargets[field.apiKey] = targets;
      }
    }
  }

  return [
    'model_fields',
    `id=${JSON.stringify(manifest.id)}`,
    `api_key=${JSON.stringify(manifest.apiKey)}`,
    `kind=${manifest.kind}`,
    `fields_by_type=${JSON.stringify(fieldsByType)}`,
    ...(localizedFields.length > 0
      ? [`localized_fields=${JSON.stringify(localizedFields)}`]
      : []),
    ...(Object.keys(fieldRoles).length > 0
      ? [`field_roles=${JSON.stringify(fieldRoles)}`]
      : []),
    ...(Object.keys(fieldTargets).length > 0
      ? [`field_targets=${JSON.stringify(fieldTargets)}`]
      : []),
  ].join('|');
}

function renderFieldDirectory(
  manifests: readonly ModelContextManifest[],
  totalModelCount: number,
  sourceIncompleteModelCount: number,
): string {
  const complete =
    manifests.length === totalModelCount && sourceIncompleteModelCount === 0;
  const header = [
    'field_directory',
    `field_coverage_complete=${complete}`,
    `models=${manifests.length}/${totalModelCount}`,
    `omitted_models=${totalModelCount - manifests.length}`,
    `source_incomplete_models=${sourceIncompleteModelCount}`,
    `relationship_targets=bounded`,
    `max_relationship_targets_per_field=${FIELD_DIRECTORY_TARGET_LIMIT}`,
  ].join('|');

  return [header, ...manifests.map(renderFieldDirectoryModel)].join('\n');
}

/**
 * Builds a coverage-first schema summary for read routing. It intentionally
 * omits validators, hints and editor configuration, while retaining every
 * model's field API keys, field types, localization and presentation roles.
 * Relationship targets are bounded hints, and every truncated list carries
 * an explicit omitted count.
 */
export function buildStandaloneFieldDirectory({
  itemTypes,
  fields,
  maxCharacters: rawMaxCharacters,
  ...rawOptions
}: BuildStandaloneFieldDirectoryInput): StandaloneFieldDirectory {
  const maxCharacters = normalizeLimit(
    rawMaxCharacters,
    DEFAULT_PROJECT_MAP_CHARACTER_LIMIT,
  );

  if (maxCharacters < MINIMUM_PROJECT_MAP_CHARACTER_LIMIT) {
    throw new RangeError(
      `Field directory maxCharacters must be at least ${MINIMUM_PROJECT_MAP_CHARACTER_LIMIT}.`,
    );
  }

  const sortedItemTypes = [...itemTypes].sort(
    (left, right) =>
      Number(left.attributes.modular_block) -
        Number(right.attributes.modular_block) ||
      left.attributes.api_key.localeCompare(right.attributes.api_key),
  );
  const manifests = sortedItemTypes.map((itemType) =>
    buildModelContextManifest({
      itemType,
      itemTypes: sortedItemTypes,
      fields,
      ...rawOptions,
    }),
  );
  const sourceIncompleteModelApiKeys = manifests
    .filter((manifest) => !manifest.fieldsComplete)
    .map((manifest) => manifest.apiKey);
  const included: ModelContextManifest[] = [];
  const omitted: ModelContextManifest[] = [];

  for (const manifest of manifests) {
    const candidate = renderFieldDirectory(
      [...included, manifest],
      manifests.length,
      sourceIncompleteModelApiKeys.length,
    );

    if (candidate.length <= maxCharacters) {
      included.push(manifest);
    } else {
      omitted.push(manifest);
    }
  }

  const text = renderFieldDirectory(
    included,
    manifests.length,
    sourceIncompleteModelApiKeys.length,
  );

  if (text.length > maxCharacters) {
    throw new RangeError(
      'Field directory maxCharacters is too small for completeness metadata.',
    );
  }

  return {
    text,
    characterCount: text.length,
    maxCharacters,
    complete: omitted.length === 0 && sourceIncompleteModelApiKeys.length === 0,
    includedModelApiKeys: included.map((manifest) => manifest.apiKey),
    omittedModelApiKeys: omitted.map((manifest) => manifest.apiKey),
    sourceIncompleteModelApiKeys,
  };
}
