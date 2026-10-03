import type { SchemaTypes } from '@datocms/cma-client-browser';
import type { OnBeforeItemUpsertCtx } from 'datocms-plugin-sdk';
import { buildTreeClient, readWithRetry } from './cmaRequests';
import updateAllChildrenSlugs, {
  isSlugValue,
  PropagationError,
  type PropagationProgress,
  type SlugChanges,
  type SlugValue,
  type TreeRecord,
} from './updateAllChildrenSlugs';

type UpsertPayload =
  | SchemaTypes.ItemCreateSchema
  | SchemaTypes.ItemUpdateSchema;
const CURRENT = { nested: false, version: 'current' } as const;

// Overlapping saves in this boot iframe must not propagate two prefixes at once.
// This is intentionally in-memory and continuous; it is not a persisted job.
const modelQueues = new Map<string, Promise<unknown>>();

async function serializeModel<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = modelQueues.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  modelQueues.set(key, result);
  try {
    return await result;
  } finally {
    if (modelQueues.get(key) === result) modelQueues.delete(key);
  }
}

function isNotFound(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response &&
    error.response.status === 404
  );
}

function hasOwn(record: object, key: string): boolean {
  return Object.getOwnPropertyDescriptor(record, key) !== undefined;
}

class SaveValidationError extends Error {}

function changedPrefix(
  current: unknown,
  incoming: SlugValue,
): SlugValue | undefined {
  if (typeof incoming !== 'object' || incoming === null) {
    return current === incoming ? undefined : incoming;
  }
  const oldLocales =
    isSlugValue(current) && typeof current === 'object' && current
      ? current
      : {};
  const changes = Object.fromEntries(
    Object.entries(incoming).filter(
      ([locale, value]) => oldLocales[locale] !== value,
    ),
  );
  return Object.keys(changes).length > 0 ? changes : undefined;
}

function progressFeedback(ctx: OnBeforeItemUpsertCtx) {
  let latest: PropagationProgress | undefined;
  let lastNotification = -Infinity;
  let timer: ReturnType<typeof setInterval> | undefined;
  const notify = () => {
    const progress = latest;
    if (!progress) return;
    const large =
      progress.phase === 'loading'
        ? progress.modelTotal >= 1000
        : progress.total >= 1000;
    if (!large) return;
    const now = Date.now();
    if (progress.phase !== 'complete' && now - lastNotification < 5000) return;
    lastNotification = now;
    const message =
      progress.phase === 'loading'
        ? `Loading slug tree: ${progress.scanned.toLocaleString()} of ${progress.modelTotal.toLocaleString()} records.`
        : `Child slugs: ${progress.processed.toLocaleString()} of ${progress.total.toLocaleString()} checked; ${progress.updated.toLocaleString()} updated.`;
    // Never await a toast: the dashboard resolves it only when dismissed.
    try {
      void ctx
        .customToast({
          type: 'notice',
          message,
          dismissAfterTimeout: 4000,
          dismissOnPageChange: true,
        })
        .catch(() => undefined);
    } catch {
      // A detached dashboard can also reject a notification synchronously.
    }
  };
  return {
    update(progress: PropagationProgress) {
      latest = progress;
      if (!timer && (progress.modelTotal >= 1000 || progress.total >= 1000))
        timer = setInterval(notify, 5000);
      notify();
    },
    stop() {
      clearInterval(timer);
    },
  };
}

function failureMessage(error: unknown): string {
  if (error instanceof SaveValidationError) return error.message;
  if (error instanceof PropagationError) {
    const { processed, total, updated } = error.progress;
    const partial =
      error.progress.phase === 'updating' && total > 0
        ? ' Confirmed child updates have already been saved; an unconfirmed request may also have reached the server.'
        : '';
    return `The parent was not saved. Child slug propagation failed after checking ${processed.toLocaleString()} of ${total.toLocaleString()} descendants (${updated.toLocaleString()} updates confirmed). ${error.message}${partial}`;
  }
  // CMA errors embed the Authorization header; never include their message.
  return 'The parent was not saved because the plugin could not safely read or update the slug tree.';
}

type PluginFields = Awaited<
  ReturnType<OnBeforeItemUpsertCtx['loadFieldsUsingPlugin']>
>;

function collectPrefixes(
  root: TreeRecord,
  attributes: Record<string, unknown>,
  fields: PluginFields,
): SlugChanges {
  const prefixes: SlugChanges = {};
  for (const field of fields) {
    if (
      field.relationships.item_type.data.id !==
        root.relationships.item_type.data.id ||
      field.attributes.field_type !== 'slug'
    )
      continue;
    const key = field.attributes.api_key;
    if (!hasOwn(attributes, key)) continue;
    const incoming = attributes[key];
    if (!isSlugValue(incoming))
      throw new SaveValidationError(
        'The parent was not saved because its slug value is invalid.',
      );
    const prefix = changedPrefix(root.attributes[key], incoming);
    if (prefix !== undefined) prefixes[key] = prefix;
  }
  return prefixes;
}

function prepareSave(
  payload: UpsertPayload,
  root: TreeRecord,
  fields: PluginFields,
) {
  const expectedVersion = payload.data.meta?.current_version;
  if (expectedVersion && expectedVersion !== root.meta.current_version) {
    throw new SaveValidationError(
      'The parent record changed before the slug update. The parent was not saved.',
    );
  }
  const attributes = payload.data.attributes ?? {};
  const prefixes = collectPrefixes(root, attributes, fields);
  const newParent = hasOwn(attributes, 'parent_id')
    ? attributes.parent_id
    : undefined;
  if (
    newParent !== undefined &&
    newParent !== null &&
    typeof newParent !== 'string'
  ) {
    throw new SaveValidationError(
      'The parent was not saved because its tree parent is invalid.',
    );
  }
  return {
    prefixes,
    newParent: newParent !== root.attributes.parent_id ? newParent : undefined,
  };
}

async function readRoot(
  client: ReturnType<typeof buildTreeClient>,
  recordId: string,
): Promise<TreeRecord | null> {
  try {
    return (await readWithRetry(() => client.items.rawFind(recordId, CURRENT)))
      .data;
  } catch (error) {
    // Only an actual 404 indicates a new record with a preallocated ID.
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function propagateSave(
  payload: UpsertPayload,
  ctx: OnBeforeItemUpsertCtx,
  fields: PluginFields,
) {
  const recordId = payload.data.id;
  if (!recordId) return true;
  if (!ctx.currentUserAccessToken) {
    throw new SaveValidationError(
      'This user does not have permission to run this plugin. It needs the currentUserAccessToken.',
    );
  }
  const client = buildTreeClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
  });
  const root = await readRoot(client, recordId);
  if (!root) return true;
  const { prefixes, newParent } = prepareSave(payload, root, fields);
  if (Object.keys(prefixes).length === 0 && newParent === undefined)
    return true;
  const feedback = progressFeedback(ctx);
  try {
    await updateAllChildrenSlugs(
      client,
      root.relationships.item_type.data.id,
      root,
      prefixes,
      {
        ...(newParent !== undefined ? { newParent } : {}),
        onProgress: feedback.update,
      },
    );
    return true;
  } finally {
    feedback.stop();
  }
}

export default async function beforeItemUpsert(
  payload: UpsertPayload,
  ctx: OnBeforeItemUpsertCtx,
) {
  if (ctx.plugin.attributes.parameters?.onPublish || !payload.data.id)
    return true;
  const attributes = payload.data.attributes;
  if (!attributes || Object.keys(attributes).length === 0) return true;
  try {
    const fields = await ctx.loadFieldsUsingPlugin();
    const modelId = payload.data.relationships?.item_type?.data.id;
    const relevantFields = fields.filter(
      (field) =>
        field.attributes.field_type === 'slug' &&
        (!modelId || field.relationships.item_type.data.id === modelId),
    );
    const hasSlug = relevantFields.some((field) =>
      hasOwn(attributes, field.attributes.api_key),
    );
    const hasParent =
      hasOwn(attributes, 'parent_id') && relevantFields.length > 0;
    if (!hasSlug && !hasParent) return true;
    // Updates may omit item_type, so a model-keyed fallback would allow two
    // queues for the same model. Serialize the environment in this boot iframe.
    const key = ctx.environment;
    return await serializeModel(key, () =>
      propagateSave(payload, ctx, relevantFields),
    );
  } catch (error) {
    try {
      await ctx.alert(failureMessage(error));
    } catch {
      // Losing the dashboard connection must still block an unsafe save.
    }
    return false;
  }
}
