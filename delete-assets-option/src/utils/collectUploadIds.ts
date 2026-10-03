export type UploadFieldDescriptor = {
  api_key: string;
  field_type: string;
  localized: boolean;
};

type UploadFieldType =
  | 'file'
  | 'gallery'
  | 'seo'
  | 'rich_text'
  | 'single_block'
  | 'structured_text';

type RelevantField = UploadFieldDescriptor & { field_type: UploadFieldType };
type PendingRecord = { kind: 'record'; value: unknown; source: string };
type PendingField = {
  kind: 'field';
  value: unknown;
  field: RelevantField;
  localized: boolean;
};
type PendingNode = { kind: 'node'; value: unknown; source: string };
type PendingValue = PendingRecord | PendingField | PendingNode;
type CollectorState = {
  uploadIds: Set<string>;
  visitedRecords: WeakSet<object>;
  visitedNodes: WeakSet<object>;
  pending: PendingValue[];
  onUploadId?: (id: string) => void;
};

const containerNodeTypes = new Set([
  'root',
  'paragraph',
  'heading',
  'list',
  'listItem',
  'blockquote',
  'link',
  'itemLink',
]);
const leafNodeTypes = new Set(['span', 'itemSpan', 'code', 'thematicBreak']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): unknown {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn needs ES2022; this plugin targets ES2020.
  return Object.prototype.hasOwnProperty.call(value, key)
    ? value[key]
    : undefined;
}

function isUploadFieldType(value: string): value is UploadFieldType {
  return (
    value === 'file' ||
    value === 'gallery' ||
    value === 'seo' ||
    value === 'rich_text' ||
    value === 'single_block' ||
    value === 'structured_text'
  );
}

function invalidShape(source: string, expected: string): Error {
  return new Error(`Cannot inspect ${source}: expected ${expected}.`);
}

function addUploadId(
  value: unknown,
  source: string,
  state: CollectorState,
): void {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string') {
    throw invalidShape(source, 'an upload ID string');
  }
  if (value.trim().length > 0 && !state.uploadIds.has(value)) {
    state.uploadIds.add(value);
    state.onUploadId?.(value);
  }
}

function collectFile(
  value: unknown,
  source: string,
  state: CollectorState,
): void {
  if (value === undefined || value === null) return;
  if (!isObject(value) || own(value, 'upload_id') === undefined) {
    throw invalidShape(source, 'a file with upload_id');
  }
  addUploadId(own(value, 'upload_id'), source, state);
}

function collectGallery(
  value: unknown,
  source: string,
  state: CollectorState,
): void {
  if (!Array.isArray(value)) throw invalidShape(source, 'a gallery array');
  for (const file of value) collectFile(file, source, state);
}

function collectSeo(
  value: unknown,
  source: string,
  state: CollectorState,
): void {
  if (!isObject(value)) throw invalidShape(source, 'an SEO object');
  addUploadId(own(value, 'image'), source, state);
}

function enqueueLocalized(task: PendingField, state: CollectorState): void {
  if (!isObject(task.value)) {
    throw invalidShape(
      `field "${task.field.api_key}"`,
      'a map of localized values',
    );
  }
  const locales = Object.keys(task.value);
  for (let index = locales.length - 1; index >= 0; index -= 1) {
    state.pending.push({
      ...task,
      value: own(task.value, locales[index]),
      localized: false,
    });
  }
}

function enqueueModularContent(
  value: unknown,
  source: string,
  state: CollectorState,
): void {
  if (!Array.isArray(value)) {
    throw invalidShape(source, 'a modular content array');
  }
  for (let index = value.length - 1; index >= 0; index -= 1) {
    state.pending.push({ kind: 'record', value: value[index], source });
  }
}

function enqueueStructuredText(
  value: unknown,
  source: string,
  state: CollectorState,
): void {
  const root = isObject(value) ? own(value, 'document') : undefined;
  if (
    !isObject(value) ||
    own(value, 'schema') !== 'dast' ||
    !isObject(root) ||
    own(root, 'type') !== 'root'
  ) {
    throw invalidShape(source, 'a Structured Text document');
  }
  state.pending.push({ kind: 'node', value: root, source });
}

function inspectField(task: PendingField, state: CollectorState): void {
  if (task.value === undefined || task.value === null) return;
  if (task.localized) {
    enqueueLocalized(task, state);
    return;
  }

  const source = `field "${task.field.api_key}"`;
  switch (task.field.field_type) {
    case 'file':
      collectFile(task.value, source, state);
      break;
    case 'gallery':
      collectGallery(task.value, source, state);
      break;
    case 'seo':
      collectSeo(task.value, source, state);
      break;
    case 'single_block':
      state.pending.push({ kind: 'record', value: task.value, source });
      break;
    case 'rich_text':
      enqueueModularContent(task.value, source, state);
      break;
    case 'structured_text':
      enqueueStructuredText(task.value, source, state);
      break;
  }
}

async function inspectRecord(
  task: PendingRecord,
  state: CollectorState,
  modelFields: (modelId: string) => Promise<RelevantField[]>,
): Promise<void> {
  if (!isObject(task.value) || own(task.value, 'type') !== 'item') {
    throw invalidShape(task.source, 'a raw nested CMA item (nested:true)');
  }
  if (state.visitedRecords.has(task.value)) return;
  state.visitedRecords.add(task.value);

  const attributes = own(task.value, 'attributes');
  const relationships = own(task.value, 'relationships');
  const itemType = isObject(relationships)
    ? own(relationships, 'item_type')
    : undefined;
  const model = isObject(itemType) ? own(itemType, 'data') : undefined;
  const modelId = isObject(model) ? own(model, 'id') : undefined;
  if (
    !isObject(attributes) ||
    typeof modelId !== 'string' ||
    modelId.trim().length === 0
  ) {
    throw invalidShape(task.source, 'item attributes and an item_type ID');
  }

  const fields = await modelFields(modelId);
  for (let index = fields.length - 1; index >= 0; index -= 1) {
    const field = fields[index];
    state.pending.push({
      kind: 'field',
      value: own(attributes, field.api_key),
      field,
      localized: field.localized,
    });
  }
}

function inspectNode(task: PendingNode, state: CollectorState): void {
  const type = isObject(task.value) ? own(task.value, 'type') : undefined;
  if (!isObject(task.value) || typeof type !== 'string') {
    throw invalidShape(task.source, 'a Structured Text node');
  }
  if (state.visitedNodes.has(task.value)) return;
  state.visitedNodes.add(task.value);

  if (type === 'block' || type === 'inlineBlock') {
    state.pending.push({
      kind: 'record',
      value: own(task.value, 'item'),
      source: task.source,
    });
    return;
  }

  // Traverse only the DAST tree. itemLink/itemSpan reference other records,
  // and their item values must never be followed as blocks.
  const children = own(task.value, 'children');
  if (!containerNodeTypes.has(type)) {
    if (!leafNodeTypes.has(type) || children !== undefined) {
      throw invalidShape(task.source, 'a supported Structured Text node');
    }
    return;
  }
  if (!Array.isArray(children)) {
    throw invalidShape(task.source, 'a Structured Text children array');
  }
  for (let index = children.length - 1; index >= 0; index -= 1) {
    state.pending.push({
      kind: 'node',
      value: children[index],
      source: task.source,
    });
  }
}

/**
 * Inspect raw CMA records fetched with nested:true. Only schema-defined asset
 * fields and embedded blocks count; JSON, file metadata and record links do not.
 * Keep one collector per operation so model requests and relevant descriptors
 * are shared without retaining records or their collected assets between calls.
 */
export function createUploadCollector(
  loadFields: (modelId: string) => Promise<readonly UploadFieldDescriptor[]>,
  options: { signal?: AbortSignal; onUploadId?: (id: string) => void } = {},
): (record: unknown) => Promise<string[]> {
  const fieldsByModel = new Map<string, Promise<RelevantField[]>>();

  function modelFields(modelId: string): Promise<RelevantField[]> {
    const cached = fieldsByModel.get(modelId);
    if (cached) return cached;

    const request = Promise.resolve()
      .then(() => loadFields(modelId))
      .then((fields) => {
        const relevant: RelevantField[] = [];
        for (const field of fields) {
          if (isUploadFieldType(field.field_type)) {
            relevant.push({
              api_key: field.api_key,
              field_type: field.field_type,
              localized: field.localized,
            });
          }
        }
        return relevant;
      })
      .catch((error: unknown) => {
        // A failed schema read must stop this scan, but must not poison a retry.
        fieldsByModel.delete(modelId);
        throw error;
      });
    fieldsByModel.set(modelId, request);
    return request;
  }

  return async (record) => {
    const state: CollectorState = {
      uploadIds: new Set<string>(),
      visitedRecords: new WeakSet<object>(),
      visitedNodes: new WeakSet<object>(),
      pending: [{ kind: 'record', value: record, source: 'record' }],
      onUploadId: options.onUploadId,
    };

    while (state.pending.length > 0) {
      options.signal?.throwIfAborted();
      const task = state.pending.pop();
      if (!task) continue;
      switch (task.kind) {
        case 'record':
          // biome-ignore lint/performance/noAwaitInLoops: Iterative traversal bounds memory and shares each model request.
          await inspectRecord(task, state, modelFields);
          break;
        case 'field':
          inspectField(task, state);
          break;
        case 'node':
          inspectNode(task, state);
          break;
      }
    }

    options.signal?.throwIfAborted();
    return [...state.uploadIds];
  };
}
