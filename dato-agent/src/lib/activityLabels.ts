export type ActivityLabelStatus =
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'waiting';

type UnknownRecord = Record<string, unknown>;

interface MethodCoordinate {
  resource: string;
  method: string;
}

type WriteAction = 'create' | 'update' | 'delete' | 'publish' | 'unpublish';

type WriteTarget = 'records' | 'assets' | 'content_model';

interface WriteClassification {
  action?: WriteAction;
  bulk: boolean;
  target?: WriteTarget;
}

interface WriteActionLabels {
  active: string;
  waiting: string;
}

interface LiteralMethodCall extends MethodCoordinate {
  argumentsCode: string;
}

const MAX_INSPECTED_SCRIPT_CHARACTERS = 100_000;
const MAX_INSPECTED_LITERAL_METHOD_CALLS = 16;
const MAX_IDENTIFIER_CHARACTERS = 40;
const MAX_ACTIVITY_LABEL_CHARACTERS = 80;
const MAX_VISIBLE_COUNT = 9_999;

const READ_METHODS = new Set([
  'all',
  'count',
  'find',
  'iter',
  'iterator',
  'list',
  'listpagediterator',
  'rawall',
  'rawcurrentvspublishedstate',
  'rawfind',
  'rawlist',
  'rawlistpagediterator',
  'rawreferences',
  'rawreferencing',
  'rawrelated',
  'rawretrieve',
  'rawvalidateexisting',
  'rawvalidatenew',
  'references',
  'referencing',
  'related',
  'retrieve',
  'currentvspublishedstate',
  'validateexisting',
  'validatenew',
]);

const BULK_RECORD_METHODS = new Set([
  'bulkdestroy',
  'bulkmovetostage',
  'bulkpublish',
  'bulkunpublish',
]);

const WRITE_ACTION_LABELS: Record<
  WriteAction,
  Record<Exclude<WriteTarget, 'content_model'>, WriteActionLabels>
> = {
  create: {
    records: {
      active: 'Creating records',
      waiting: 'Preparing record creation',
    },
    assets: {
      active: 'Creating assets',
      waiting: 'Preparing asset creation',
    },
  },
  update: {
    records: {
      active: 'Updating records',
      waiting: 'Preparing record updates',
    },
    assets: {
      active: 'Updating assets',
      waiting: 'Preparing asset updates',
    },
  },
  delete: {
    records: {
      active: 'Deleting records',
      waiting: 'Preparing record deletion',
    },
    assets: {
      active: 'Deleting assets',
      waiting: 'Preparing asset deletion',
    },
  },
  publish: {
    records: {
      active: 'Publishing records',
      waiting: 'Preparing record publishing',
    },
    assets: {
      active: 'Publishing assets',
      waiting: 'Preparing asset publishing',
    },
  },
  unpublish: {
    records: {
      active: 'Unpublishing records',
      waiting: 'Preparing record unpublishing',
    },
    assets: {
      active: 'Unpublishing assets',
      waiting: 'Preparing asset unpublishing',
    },
  },
};

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function boundedLabel(value: string): string {
  if (value.length <= MAX_ACTIVITY_LABEL_CHARACTERS) {
    return value;
  }

  return value.slice(0, MAX_ACTIVITY_LABEL_CHARACTERS).trimEnd();
}

function humanizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const identifier = value.trim();
  if (
    identifier.length === 0 ||
    identifier.length > MAX_IDENTIFIER_CHARACTERS ||
    !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(identifier) ||
    /^(?:api_?key|bearer|pk|secret|sk|token)(?:_|$)/.test(identifier)
  ) {
    return undefined;
  }

  const words = identifier
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split('_')
    .flatMap((part) => part.split(/\s+/))
    .filter(Boolean)
    .map((word) => {
      if (['api', 'cms', 'id', 'seo', 'url'].includes(word)) {
        return word.toUpperCase();
      }

      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(' ');

  return words.length > 0 && words.length <= MAX_IDENTIFIER_CHARACTERS
    ? words
    : undefined;
}

function explicitArrayCount(
  argumentsRecord: UnknownRecord | undefined,
  key: string,
): number | undefined {
  const value = argumentsRecord?.[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_VISIBLE_COUNT
  ) {
    return undefined;
  }

  return value.length;
}

function countedNoun(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function prefixedCountLabel(
  argumentsRecord: UnknownRecord | undefined,
  key: string,
  prefix: string,
  singular: string,
  plural: string,
  fallback: string,
): string {
  const count = explicitArrayCount(argumentsRecord, key);
  return count ? `${prefix} ${countedNoun(count, singular, plural)}` : fallback;
}

function suffixedCountLabel(
  argumentsRecord: UnknownRecord | undefined,
  key: string,
  singular: string,
  plural: string,
  suffix: string,
  fallback: string,
): string {
  const count = explicitArrayCount(argumentsRecord, key);
  return count ? `${countedNoun(count, singular, plural)} ${suffix}` : fallback;
}

function coordinateKey({ resource, method }: MethodCoordinate): string {
  return `${resource}\u0000${method}`;
}

function coordinateFromMethodToken(
  token: unknown,
): MethodCoordinate | undefined {
  if (typeof token !== 'string') {
    return undefined;
  }

  const match = token.match(
    /^m\.([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\.[A-Za-z0-9_-]{1,256}$/,
  );
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return { resource: match[1], method: match[2] };
}

// Script text is untrusted model output. Masking strings and comments prevents
// labels from treating prose examples as executable CMA calls.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: A small scanner is safer than regex-only string/comment removal for generated TypeScript.
function maskTypeScriptNonCode(source: string): string {
  type State =
    | 'code'
    | 'single_quote'
    | 'double_quote'
    | 'template'
    | 'line_comment'
    | 'block_comment';

  let state: State = 'code';
  let escaped = false;
  const result: string[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';

    if (state === 'code') {
      if (character === '/' && next === '/') {
        result.push(' ', ' ');
        index += 1;
        state = 'line_comment';
      } else if (character === '/' && next === '*') {
        result.push(' ', ' ');
        index += 1;
        state = 'block_comment';
      } else if (character === "'") {
        result.push(' ');
        state = 'single_quote';
      } else if (character === '"') {
        result.push(' ');
        state = 'double_quote';
      } else if (character === '`') {
        result.push(' ');
        state = 'template';
      } else {
        result.push(character);
      }
      continue;
    }

    if (state === 'line_comment') {
      result.push(character === '\n' || character === '\r' ? character : ' ');
      if (character === '\n' || character === '\r') {
        state = 'code';
      }
      continue;
    }

    if (state === 'block_comment') {
      result.push(character === '\n' || character === '\r' ? character : ' ');
      if (character === '*' && next === '/') {
        result.push(' ');
        index += 1;
        state = 'code';
      }
      continue;
    }

    result.push(character === '\n' || character === '\r' ? character : ' ');
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (
      (state === 'single_quote' && character === "'") ||
      (state === 'double_quote' && character === '"') ||
      (state === 'template' && character === '`')
    ) {
      state = 'code';
    }
  }

  return result.join('');
}

function containsPotentialCoordinateRegexLiteral(source: string): boolean {
  return /(^|[=(:,;!&|?{}[\]\s])\/(?![/*])(?:\\.|[^/\\\r\n])*\bclient\.[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*\s*\((?:\\.|[^/\\\r\n])*\/(?:[dgimsuvy]*)/m.test(
    source,
  );
}

function closingParenthesisIndex(
  code: string,
  openingParenthesis: number,
): number | undefined {
  let depth = 1;
  for (let index = openingParenthesis + 1; index < code.length; index += 1) {
    if (code[index] === '(') {
      depth += 1;
    } else if (code[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This bounded scanner deliberately validates source coordinates, method tokens, balanced calls, and conservative fallbacks in one pass.
function literalMethodCoordinates(
  argumentsRecord: UnknownRecord,
): { calls: LiteralMethodCall[]; coordinates: MethodCoordinate[] } | undefined {
  const body = asRecord(argumentsRecord.body);
  const source = body?.mode === 'full' ? body.content : undefined;
  const methodTokens = argumentsRecord.method_tokens;

  if (
    typeof source !== 'string' ||
    source.length === 0 ||
    source.length > MAX_INSPECTED_SCRIPT_CHARACTERS ||
    !Array.isArray(methodTokens) ||
    containsPotentialCoordinateRegexLiteral(source)
  ) {
    return undefined;
  }

  const tokenCoordinates = new Set(
    methodTokens
      .map(coordinateFromMethodToken)
      .filter((coordinate): coordinate is MethodCoordinate =>
        Boolean(coordinate),
      )
      .map(coordinateKey),
  );
  if (tokenCoordinates.size === 0) {
    return undefined;
  }

  const code = maskTypeScriptNonCode(source);
  const callPattern =
    /\bclient\.([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*<[^<>()]{1,200}>)?\s*\(/g;
  const coordinates = new Map<string, MethodCoordinate>();
  const calls: LiteralMethodCall[] = [];
  for (const match of code.matchAll(callPattern)) {
    const resource = match[1];
    const method = match[2];
    if (!resource || !method) {
      continue;
    }
    const coordinate = { resource, method };
    const key = coordinateKey(coordinate);
    if (tokenCoordinates.has(key)) {
      if (calls.length >= MAX_INSPECTED_LITERAL_METHOD_CALLS) {
        return undefined;
      }
      const openingParenthesis = (match.index ?? 0) + match[0].lastIndexOf('(');
      const closingParenthesis = closingParenthesisIndex(
        code,
        openingParenthesis,
      );
      if (closingParenthesis === undefined) {
        return undefined;
      }
      coordinates.set(key, coordinate);
      calls.push({
        ...coordinate,
        argumentsCode: code.slice(openingParenthesis + 1, closingParenthesis),
      });
    }
  }

  return coordinates.size > 0
    ? { calls, coordinates: [...coordinates.values()] }
    : undefined;
}

function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toLowerCase());
}

function literalPropertyValueStartAt(
  code: string,
  index: number,
  property: string,
): number | undefined {
  if (!code.startsWith(property, index)) {
    return undefined;
  }
  if (
    /[A-Za-z0-9_$]/.test(code[index - 1] ?? '') ||
    /[A-Za-z0-9_$]/.test(code[index + property.length] ?? '')
  ) {
    return undefined;
  }

  let cursor = index + property.length;
  while (/\s/.test(code[cursor] ?? '')) cursor += 1;
  if (code[cursor] !== ':') return undefined;
  cursor += 1;
  while (/\s/.test(code[cursor] ?? '')) cursor += 1;
  return cursor;
}

function directObjectPropertyValueStart(
  code: string,
  openingBrace: number,
  property: string,
): number | undefined {
  let depth = 1;
  for (let index = openingBrace + 1; index < code.length; index += 1) {
    const character = code[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return undefined;
      }
    } else if (depth === 1) {
      const valueStart = literalPropertyValueStartAt(code, index, property);
      if (valueStart !== undefined) {
        return valueStart;
      }
    }
  }

  return undefined;
}

function callHasLiteralSearchFilter(argumentsCode: string): boolean {
  const argumentsStart = argumentsCode.search(/\S/);
  if (argumentsStart === -1 || argumentsCode[argumentsStart] !== '{') {
    return false;
  }

  const filterValueStart = directObjectPropertyValueStart(
    argumentsCode,
    argumentsStart,
    'filter',
  );
  return (
    filterValueStart !== undefined &&
    argumentsCode[filterValueStart] === '{' &&
    directObjectPropertyValueStart(argumentsCode, filterValueStart, 'query') !==
      undefined
  );
}

function safeScriptLabel(argumentsRecord: UnknownRecord): string {
  if (argumentsRecord.no_execute === true) {
    return 'Saving a CMS operation';
  }

  const script = literalMethodCoordinates(argumentsRecord);
  if (!script) {
    return 'Reading CMS content';
  }

  const { calls, coordinates } = script;
  if (!coordinates.every(({ method }) => isReadMethod(method))) {
    return 'Reading CMS content';
  }

  if (coordinates.every(({ resource }) => resource === 'items')) {
    const listMethods = new Set([
      'all',
      'list',
      'listpagediterator',
      'rawall',
      'rawlist',
      'rawlistpagediterator',
    ]);
    const hasSearchCall = calls.some(
      ({ argumentsCode, method }) =>
        listMethods.has(method.toLowerCase()) &&
        callHasLiteralSearchFilter(argumentsCode),
    );
    return hasSearchCall ? 'Searching records' : 'Reading records';
  }

  if (coordinates.every(({ resource }) => resource === 'uploads')) {
    return 'Reading assets';
  }

  if (
    coordinates.every(({ resource }) =>
      ['itemTypes', 'fields', 'fieldsets'].includes(resource),
    )
  ) {
    return 'Reading the content model';
  }

  return 'Reading CMS content';
}

function writeTarget(resource: string): WriteTarget | undefined {
  if (resource === 'items') {
    return 'records';
  }
  if (resource === 'uploads') {
    return 'assets';
  }
  if (['itemTypes', 'fields', 'fieldsets'].includes(resource)) {
    return 'content_model';
  }
  return undefined;
}

function writeAction(method: string): WriteAction | undefined {
  const normalized = method
    .toLowerCase()
    .replace(/^raw/, '')
    .replace(/^bulk/, '');
  if (normalized === 'unpublish') {
    return 'unpublish';
  }
  if (normalized === 'publish') {
    return 'publish';
  }
  if (normalized === 'update') {
    return 'update';
  }
  if (normalized === 'create' || normalized === 'duplicate') {
    return 'create';
  }
  if (['delete', 'destroy', 'remove'].includes(normalized)) {
    return 'delete';
  }
  return undefined;
}

function classifyWrite(
  argumentsRecord: UnknownRecord,
): WriteClassification | undefined {
  const script = literalMethodCoordinates(argumentsRecord);
  if (!script) {
    return undefined;
  }

  const writeCoordinates = script.coordinates.filter(
    ({ method }) => !isReadMethod(method),
  );
  if (writeCoordinates.length === 0) {
    return undefined;
  }

  const targets = new Set(
    writeCoordinates.map(({ resource }) => writeTarget(resource)),
  );
  const actions = new Set(
    writeCoordinates.map(({ method }) => writeAction(method)),
  );
  const bulk = writeCoordinates.some(({ method }) =>
    BULK_RECORD_METHODS.has(method.toLowerCase().replace(/^raw/, '')),
  );
  const target = targets.size === 1 ? [...targets][0] : undefined;

  if (
    targets.size !== 1 ||
    targets.has(undefined) ||
    actions.size !== 1 ||
    actions.has(undefined)
  ) {
    return { bulk, ...(target ? { target } : {}) };
  }

  return {
    action: [...actions][0],
    bulk,
    target,
  };
}

function genericWriteLabel(status: ActivityLabelStatus): string {
  if (status === 'waiting') {
    return 'Preparing a CMS change';
  }
  return 'Applying CMS changes';
}

function bulkWriteLabel(status: ActivityLabelStatus): string {
  if (status === 'waiting') {
    return 'Preparing bulk record processing';
  }
  return 'Bulk processing records';
}

function actionLabel(
  action: WriteAction,
  target: Exclude<WriteTarget, 'content_model'>,
  status: ActivityLabelStatus,
): string {
  const labels = WRITE_ACTION_LABELS[action][target];
  if (status === 'waiting') {
    return labels.waiting;
  }
  return labels.active;
}

function contentModelWriteLabel(status: ActivityLabelStatus): string {
  if (status === 'waiting') {
    return 'Preparing content model changes';
  }
  return 'Updating the content model';
}

function unsafeScriptLabel(
  argumentsRecord: UnknownRecord,
  status: ActivityLabelStatus,
): string {
  if (argumentsRecord.no_execute === true) {
    return status === 'completed'
      ? 'CMS operation saved'
      : 'Saving a CMS operation';
  }

  const classification = classifyWrite(argumentsRecord);
  if (!classification) {
    return genericWriteLabel(status);
  }
  if (classification.bulk && classification.target === 'records') {
    return bulkWriteLabel(status);
  }
  if (!classification.action || !classification.target) {
    return genericWriteLabel(status);
  }
  if (classification.target === 'content_model') {
    return contentModelWriteLabel(status);
  }
  return actionLabel(classification.action, classification.target, status);
}

export function mcpActivityLabel(
  toolName: string,
  parsedArguments: unknown,
  status: ActivityLabelStatus,
): string {
  const argumentsRecord = asRecord(parsedArguments);
  let label: string;

  switch (toolName) {
    case 'list_api_resources':
      label = 'Reading available DatoCMS resources';
      break;
    case 'get_api_methods':
      label = 'Looking up relevant API methods';
      break;
    case 'get_schema':
      label = 'Reading the content model';
      break;
    case 'upsert_and_execute_safe_script':
      label = argumentsRecord
        ? safeScriptLabel(argumentsRecord)
        : 'Reading CMS content';
      break;
    case 'upsert_and_execute_unsafe_script':
      label = argumentsRecord
        ? unsafeScriptLabel(argumentsRecord, status)
        : genericWriteLabel(status);
      break;
    case 'view_script':
      label = 'Reviewing a saved operation';
      break;
    case 'whoami':
      label = 'Checking the DatoCMS connection';
      break;
    default:
      label = 'Running a DatoCMS operation';
  }

  return boundedLabel(label);
}

function localInProgressLabel(
  toolName: string,
  argumentsRecord: UnknownRecord | undefined,
): string {
  switch (toolName) {
    case 'get_model_schema': {
      const model = humanizeIdentifier(argumentsRecord?.identifier);
      return model ? `Reading ${model} fields` : 'Reading model fields';
    }
    case 'open_record':
      return 'Opening a record';
    case 'show_records': {
      return prefixedCountLabel(
        argumentsRecord,
        'records',
        'Showing',
        'record',
        'records',
        'Showing records',
      );
    }
    case 'present_records': {
      return prefixedCountLabel(
        argumentsRecord,
        'records',
        'Adding',
        'record link',
        'record links',
        'Adding record links',
      );
    }
    case 'present_fields': {
      return prefixedCountLabel(
        argumentsRecord,
        'fields',
        'Adding',
        'field link',
        'field links',
        'Adding field links',
      );
    }
    case 'read_current_record_live_form_state': {
      return prefixedCountLabel(
        argumentsRecord,
        'fields',
        'Reading',
        'current form value',
        'current form values',
        'Reading current form values',
      );
    }
    case 'present_assets': {
      return prefixedCountLabel(
        argumentsRecord,
        'assets',
        'Adding',
        'asset link',
        'asset links',
        'Adding asset links',
      );
    }
    case 'present_models': {
      return prefixedCountLabel(
        argumentsRecord,
        'models',
        'Adding',
        'model reference',
        'model references',
        'Adding model references',
      );
    }
    case 'present_users': {
      return prefixedCountLabel(
        argumentsRecord,
        'users',
        'Adding',
        'user reference',
        'user references',
        'Adding user references',
      );
    }
    case 'create_dato_asset':
      return 'Creating an asset';
    default:
      return 'Running a local action';
  }
}

function localCompletedLabel(
  toolName: string,
  argumentsRecord: UnknownRecord | undefined,
): string {
  switch (toolName) {
    case 'get_model_schema': {
      const model = humanizeIdentifier(argumentsRecord?.identifier);
      return model ? `${model} fields loaded` : 'Model fields loaded';
    }
    case 'open_record':
      return 'Record ready';
    case 'show_records': {
      return suffixedCountLabel(
        argumentsRecord,
        'records',
        'record',
        'records',
        'ready',
        'Records ready',
      );
    }
    case 'present_records': {
      return suffixedCountLabel(
        argumentsRecord,
        'records',
        'record link',
        'record links',
        'ready',
        'Record links ready',
      );
    }
    case 'present_fields': {
      return suffixedCountLabel(
        argumentsRecord,
        'fields',
        'field link',
        'field links',
        'ready',
        'Field links ready',
      );
    }
    case 'read_current_record_live_form_state': {
      return suffixedCountLabel(
        argumentsRecord,
        'fields',
        'current form value',
        'current form values',
        'read',
        'Current form values read',
      );
    }
    case 'present_assets': {
      return suffixedCountLabel(
        argumentsRecord,
        'assets',
        'asset link',
        'asset links',
        'ready',
        'Asset links ready',
      );
    }
    case 'present_models': {
      return suffixedCountLabel(
        argumentsRecord,
        'models',
        'model reference',
        'model references',
        'ready',
        'Model references ready',
      );
    }
    case 'present_users': {
      return suffixedCountLabel(
        argumentsRecord,
        'users',
        'user reference',
        'user references',
        'ready',
        'User references ready',
      );
    }
    case 'create_dato_asset':
      return 'Asset created';
    default:
      return 'Records ready';
  }
}

function localFailedLabel(toolName: string): string {
  switch (toolName) {
    case 'get_model_schema':
      return 'Could not read model fields';
    case 'present_records':
      return 'Could not add record links';
    case 'present_fields':
      return 'Could not add field links';
    case 'read_current_record_live_form_state':
      return 'Could not read current form values';
    case 'present_assets':
      return 'Could not add asset links';
    case 'present_models':
      return 'Could not add model references';
    case 'present_users':
      return 'Could not add user references';
    case 'create_dato_asset':
      return 'Asset was not created';
    default:
      return 'Could not navigate the CMS';
  }
}

export function localActivityLabel(
  toolName: string,
  parsedArguments: unknown,
  status: ActivityLabelStatus,
): string {
  const argumentsRecord = asRecord(parsedArguments);
  const label =
    status === 'completed'
      ? localCompletedLabel(toolName, argumentsRecord)
      : status === 'failed'
        ? localFailedLabel(toolName)
        : localInProgressLabel(toolName, argumentsRecord);

  return boundedLabel(label);
}
