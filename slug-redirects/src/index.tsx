import { buildClient } from '@datocms/cma-client-browser';
import { connect, type RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import ConfigScreen from './entrypoints/ConfigScreen';
import SlugExtension from './entrypoints/SlugExtension';
import { render } from './utils/render';
import updateSlugRedirects from './utils/updateSlugRedirects';

connect({
  async onBoot(ctx) {
    if (
      !ctx.plugin.attributes.parameters.installed &&
      ctx.currentUserAccessToken
    ) {
      const client = buildClient({
        apiToken: ctx.currentUserAccessToken as string,
        environment: ctx.environment,
      });

      const redirectsModel = await client.itemTypes.create({
        name: '🐌 Slug Redirects',
        api_key: 'slug_redirect',
        singleton: true,
      });

      await client.fields.create('slug_redirect', {
        label: 'redirects',
        field_type: 'json',
        api_key: 'redirects',
      });

      await client.items.create({
        item_type: { type: 'item_type', id: redirectsModel.id },
        redirects: JSON.stringify([]),
      });

      await ctx.updatePluginParameters({ installed: true });
    }
  },
  manualFieldExtensions() {
    return [
      {
        id: 'slugRedirects',
        name: 'Slug Redirects',
        type: 'addon',
        fieldTypes: ['slug'],
      },
    ];
  },
  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    switch (fieldExtensionId) {
      case 'slugRedirects':
        return render(<SlugExtension ctx={ctx} />);
    }
  },
  async onBeforeItemUpsert(createOrUpdateItemPayload, ctx) {
    if (ctx.plugin.attributes.parameters.onPublish) {
      return true;
    }

    const fieldUsingThisPlugin: Array<string> = [];
    let urlPrefix = '';

    for (const field of await ctx.loadFieldsUsingPlugin()) {
      fieldUsingThisPlugin.push(field.attributes.api_key);
      const appearanceParams = field.attributes.appearance.parameters as Record<
        string,
        unknown
      >;
      if (typeof appearanceParams.url_prefix === 'string') {
        urlPrefix = appearanceParams.url_prefix;
      }
    }

    if (!fieldUsingThisPlugin) {
      return true;
    }

    const updatedFields = Object.keys(
      createOrUpdateItemPayload.data.attributes as object,
    );

    let updatedFieldKey: string | undefined;

    for (const field of fieldUsingThisPlugin) {
      if (updatedFields.includes(field)) {
        updatedFieldKey = field;
        break;
      }
    }

    if (!updatedFieldKey) {
      return true;
    }

    // No id means we're creating a new record, so there's no previous slug to redirect from.
    const recordId = createOrUpdateItemPayload.data.id;
    if (!recordId) {
      return true;
    }

    const client = buildClient({
      apiToken: ctx.currentUserAccessToken as string,
      environment: ctx.environment,
    });

    const recordBeforeUpdate = await client.items.find(recordId);

    const attributes = createOrUpdateItemPayload.data.attributes as Record<
      string,
      unknown
    >;
    const oldSlug = recordBeforeUpdate[updatedFieldKey];
    const newSlug = attributes[updatedFieldKey];

    updateSlugRedirects(
      urlPrefix,
      oldSlug as string,
      newSlug as string,
      recordBeforeUpdate.id,
      client,
    );

    return true;
  },

  async onBeforeItemsPublish(publishItemPayload, ctx) {
    if (!ctx.plugin.attributes.parameters.onPublish) {
      return true;
    }

    const fieldUsingThisPlugin: Array<string> = [];
    let urlPrefix = '';

    for (const field of await ctx.loadFieldsUsingPlugin()) {
      fieldUsingThisPlugin.push(field.attributes.api_key);
      const appearanceParams = field.attributes.appearance.parameters as Record<
        string,
        unknown
      >;
      if (typeof appearanceParams.url_prefix === 'string') {
        urlPrefix = appearanceParams.url_prefix;
      }
    }

    if (!fieldUsingThisPlugin) {
      return true;
    }

    const updatedFields = Object.keys(
      publishItemPayload[0].attributes as object,
    );

    let updatedFieldKey: string | undefined;

    for (const field of fieldUsingThisPlugin) {
      if (updatedFields.includes(field)) {
        updatedFieldKey = field;
        break;
      }
    }

    if (!updatedFieldKey) {
      return true;
    }

    const client = buildClient({
      apiToken: ctx.currentUserAccessToken as string,
      environment: ctx.environment,
    });

    const recordBeforeUpdate = await client.items.find(
      publishItemPayload[0].id,
    );

    const attributes = publishItemPayload[0].attributes as Record<
      string,
      unknown
    >;
    const oldSlug = recordBeforeUpdate[updatedFieldKey];
    const newSlug = attributes[updatedFieldKey];

    updateSlugRedirects(
      urlPrefix,
      newSlug as string,
      oldSlug as string,
      recordBeforeUpdate.id,
      client,
    );

    return true;
  },

  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
});
