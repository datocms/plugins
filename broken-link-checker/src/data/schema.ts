import type { Field, ItemType, RenderPageCtx } from 'datocms-plugin-sdk';
import type { ContentModel, ContentSchema } from '../types';
import { cancellableRead, retryCmaRead, throwIfAborted } from './cmaRequests';

export type SchemaContext = Pick<
  RenderPageCtx,
  'itemTypes' | 'loadItemTypeFields'
> &
  Partial<Pick<RenderPageCtx, 'currentRole' | 'environment'>>;

const BLOCK_VALIDATORS = [
  'rich_text_blocks',
  'single_block_blocks',
  'structured_text_blocks',
  'structured_text_inline_blocks',
] as const;

function modelSummary(itemType: ItemType): ContentModel {
  return {
    id: itemType.id,
    name: itemType.attributes.name,
    isBlock: itemType.attributes.modular_block,
    titleFieldId: itemType.relationships.presentation_title_field.data?.id,
    fields: [],
  };
}

/** Only hide a model when its read rules conclusively exclude it. CMA remains authoritative. */
function mayReadModel(itemType: ItemType, ctx: SchemaContext): boolean {
  const attributes =
    ctx.currentRole?.meta?.final_permissions ?? ctx.currentRole?.attributes;
  if (!attributes || !ctx.environment) return true;

  const matching = (rule: Record<string, unknown>) =>
    (rule.action === 'read' || rule.action === 'all') &&
    rule.environment === ctx.environment &&
    (!rule.item_type || rule.item_type === itemType.id) &&
    (!rule.workflow ||
      rule.workflow === itemType.relationships.workflow.data?.id);

  if (
    Array.isArray(attributes.positive_item_type_permissions) &&
    !attributes.positive_item_type_permissions.some(matching)
  ) {
    return false;
  }

  return !attributes.negative_item_type_permissions?.some(
    (rule) => matching(rule) && rule.on_creator === 'anyone' && !rule.on_stage,
  );
}

function validatorModelIds(validator: unknown): string[] {
  if (!validator || typeof validator !== 'object') return [];
  const candidates = (validator as Record<string, unknown>).item_types;
  return Array.isArray(candidates)
    ? candidates.filter((id): id is string => typeof id === 'string')
    : [];
}

function blockModelIds(fields: Field[]): Set<string> {
  const ids = new Set<string>();
  for (const field of fields) {
    for (const validatorName of BLOCK_VALIDATORS) {
      const validator = (
        field.attributes.validators as Record<string, unknown>
      )[validatorName];
      for (const id of validatorModelIds(validator)) ids.add(id);
    }
  }
  return ids;
}

export function createSchemaLoader(ctx: SchemaContext): {
  models: ContentModel[];
  load: (
    modelId: string,
    signal?: AbortSignal,
    onWarning?: (warning: string) => void,
  ) => Promise<ContentSchema>;
} {
  const models = Object.values(ctx.itemTypes)
    .filter(
      (itemType): itemType is ItemType =>
        itemType !== undefined &&
        !itemType.attributes.modular_block &&
        mayReadModel(itemType, ctx),
    )
    .map(modelSummary)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const cache = new Map<
    string,
    Promise<{ model: ContentModel; blockIds: Set<string> }>
  >();

  function loadModel(modelId: string) {
    const cached = cache.get(modelId);
    if (cached) return cached;

    const promise = (async () => {
      const itemType = ctx.itemTypes[modelId];
      if (!itemType) {
        throw new Error(
          `The schema for model ${modelId} is not available. Reload the page and try again.`,
        );
      }
      // Cache one host request independently of its consumers. The SDK cannot
      // abort it, so a late success remains reusable after a scan is cancelled.
      const fields = await cancellableRead(ctx.loadItemTypeFields(modelId));
      const model: ContentModel = {
        ...modelSummary(itemType),
        fields: fields.map((field) => ({
          id: field.id,
          apiKey: field.attributes.api_key,
          label: field.attributes.label,
          type: field.attributes.field_type,
          localized: field.attributes.localized,
          editor: field.attributes.appearance.editor,
        })),
      };
      return { model, blockIds: blockModelIds(fields) };
    })();
    cache.set(modelId, promise);
    // Failed loads must be retryable after a transient host/API failure.
    void promise.catch(() => cache.delete(modelId));
    return promise;
  }

  return {
    models,
    async load(modelId, signal, onWarning) {
      const schema: ContentSchema = new Map();
      const visited = new Set<string>();
      const pending = [modelId];
      const loadDependency = async (id: string) => {
        try {
          // Retries belong to the caller, not the shared cache: cancellation
          // stops this caller's backoff and any subsequent host requests.
          return await retryCmaRead(
            () => cancellableRead(loadModel(id), signal),
            signal,
          );
        } catch (error) {
          throwIfAborted(signal);
          if (id === modelId || !onWarning) throw error;
          onWarning(
            `The schema for embedded block model ${ctx.itemTypes[id]?.attributes.name ?? id} could not be loaded; some links could not be checked.`,
          );
          return undefined;
        }
      };
      while (pending.length) {
        throwIfAborted(signal);
        const id = pending.pop();
        if (id === undefined || visited.has(id)) continue;
        visited.add(id);
        // biome-ignore lint/performance/noAwaitInLoops: One host request at a time, with cancellation between dependencies.
        const dependency = await loadDependency(id);
        if (!dependency) continue;
        schema.set(id, dependency.model);
        // A stack preserves the previous depth-first order without recursive promises.
        for (const blockId of [...dependency.blockIds].reverse())
          pending.push(blockId);
      }
      return schema;
    },
  };
}
