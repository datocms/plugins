/**
 * Tree-like Slugs Plugin
 *
 * Propagates hierarchical slugs through parent-child record relationships.
 * When a parent record's slug changes, all descendants automatically inherit
 * the updated path prefix.
 */
import {
  connect,
  type OnBeforeItemUpsertCtx,
  type RenderFieldExtensionCtx,
} from 'datocms-plugin-sdk';
import ConfigScreen from './entrypoints/ConfigScreen';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import {
  ApiError,
  buildClient,
  type Client,
} from '@datocms/cma-client-browser';
import SlugExtension from './entrypoints/SlugExtension';
import updateAllChildrenSlugs, {
  type SlugValue,
} from './utils/updateAllChildrenSlugs';

function sameSlug(current: unknown, incoming: unknown): boolean {
  if (typeof incoming !== 'object' || incoming === null) {
    return current === incoming;
  }
  if (typeof current !== 'object' || current === null) return false;
  return Object.entries(incoming).every(
    ([locale, value]) => (current as Record<string, unknown>)[locale] === value,
  );
}

type PluginField = Awaited<
  ReturnType<OnBeforeItemUpsertCtx['loadFieldsUsingPlugin']>
>[number];

async function propagateSlugChanges(
  client: Client,
  recordId: string,
  attributes: Record<string, unknown>,
  slugFields: PluginField[],
) {
  let record: Awaited<ReturnType<Client['items']['find']>>;
  try {
    record = await client.items.find(recordId, { version: 'current' });
  } catch (error) {
    // A record with a preallocated ID that is being created has no children
    if (error instanceof ApiError && error.response.status === 404) return;
    throw error;
  }

  for (const field of slugFields) {
    const key = field.attributes.api_key;
    if (
      field.relationships.item_type.data.id !== record.item_type.id ||
      sameSlug(record[key], attributes[key])
    ) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: fields are propagated one at a time
    await updateAllChildrenSlugs(
      client,
      record.item_type.id,
      recordId,
      key,
      attributes[key] as SlugValue,
    );
  }
}

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  /** Registers the field addon for slug fields */
  manualFieldExtensions() {
    return [
      {
        id: 'treeLikeSlugs',
        name: 'Tree-like slugs',
        type: 'addon',
        fieldTypes: ['slug'],
      },
    ];
  },
  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    switch (fieldExtensionId) {
      case 'treeLikeSlugs':
        return render(<SlugExtension ctx={ctx} />);
    }
  },
  /**
   * Hook triggered before a record is saved.
   * If a slug field using this plugin was modified, the change is propagated
   * to all descendant records. If that fails, the save is blocked.
   */
  async onBeforeItemUpsert(createOrUpdateItemPayload, ctx) {
    // New records have no ID and no children yet
    const recordId = createOrUpdateItemPayload.data.id;
    const attributes = createOrUpdateItemPayload.data.attributes ?? {};
    if (ctx.plugin.attributes.parameters?.onPublish || !recordId) {
      return true;
    }

    const slugFields = (await ctx.loadFieldsUsingPlugin()).filter(
      (field) =>
        field.attributes.field_type === 'slug' &&
        field.attributes.api_key in attributes,
    );
    if (slugFields.length === 0) {
      return true;
    }

    if (!ctx.currentUserAccessToken) {
      await ctx.alert(
        'This user does not have permission to run this plugin. It needs the currentUserAccessToken.',
      );
      return false;
    }

    const client = buildClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });

    try {
      await propagateSlugChanges(client, recordId, attributes, slugFields);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await ctx.alert(
        `The record was not saved because its child slugs could not be updated: ${message}`,
      );
      return false;
    }

    return true;
  },
});
