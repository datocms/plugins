/**
 * Tree-like Slugs Plugin
 *
 * Propagates hierarchical slugs through parent-child record relationships.
 * When a parent record's slug changes, all descendants automatically inherit
 * the updated path prefix.
 */
import {
  RenderFieldExtensionCtx,
  connect,
} from 'datocms-plugin-sdk';
import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import 'datocms-react-ui/styles.css';
import SlugExtension from './entrypoints/SlugExtension';
import updateAllChildrenSlugs from './utils/updateAllChildrenSlugs';
import { buildClient } from '@datocms/cma-client-browser';

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
   * Checks if a slug field using this plugin was modified and propagates
   * the change to all descendant records.
   */
  async onBeforeItemUpsert(createOrUpdateItemPayload, ctx) {
    if (!ctx.currentUserAccessToken) {
      await ctx.alert('This user does not have permission to run this plugin. It needs the currentUserAccessToken.');
      return true;
    }

    const pluginParams = ctx.plugin.attributes.parameters as Record<string, unknown> | undefined;
    if (pluginParams?.onPublish) {
      return true;
    }

    // Collect all slug fields that have this plugin enabled
    const fieldsUsingPlugin = (await ctx.loadFieldsUsingPlugin()).map(
      (field) => field.attributes.api_key
    );

    if (fieldsUsingPlugin.length === 0) {
      return true;
    }

    // Determine which fields were modified in this save operation
    const updatedFields = Object.keys(
      createOrUpdateItemPayload.data.attributes ?? {}
    );

    // Find if any plugin-enabled slug field was updated
    const updatedFieldKey = fieldsUsingPlugin.find((field) =>
      updatedFields.includes(field)
    );

    if (!updatedFieldKey) {
      return true;
    }

    // Skip slug propagation for NEW records - they have no children yet
    // and running this on new records causes the bug where the new record's
    // slug gets incorrectly prepended to other existing records
    const recordId = createOrUpdateItemPayload.data.id;

    // No record ID means this is definitely a new record - skip propagation
    if (!recordId) {
      return true;
    }

    // Validate required data exists before proceeding
    const modelId = createOrUpdateItemPayload.data.relationships?.item_type?.data.id;
    const attributes = createOrUpdateItemPayload.data.attributes;
    const newSlugValue = attributes?.[updatedFieldKey];

    if (!modelId || typeof newSlugValue !== 'string') {
      return true;
    }

    const client = buildClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
    });

    try {
      // Try to fetch the record - if it doesn't exist, this is a new record
      await client.items.find(recordId);
    } catch {
      // Record doesn't exist yet (it's being created), skip propagation
      return true;
    }

    try {
      await updateAllChildrenSlugs(
        ctx.currentUserAccessToken,
        ctx.environment,
        modelId,
        recordId,
        updatedFieldKey,
        newSlugValue
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await ctx.alert(`Failed to update child slugs: ${message}`);
    }

    return true;
  },
});
