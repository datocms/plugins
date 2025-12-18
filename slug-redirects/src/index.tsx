import {
  IntentCtx,
  RenderFieldExtensionCtx,
  connect,
} from 'datocms-plugin-sdk';
import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import { buildClient } from '@datocms/cma-client-browser';
import SlugExtension from './entrypoints/SlugExtension';
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
  manualFieldExtensions(ctx: IntentCtx) {
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

    let fieldUsingThisPlugin: Array<string> = [];
    let urlPrefix = '';

    (await ctx.loadFieldsUsingPlugin()).map((field) => {
      fieldUsingThisPlugin.push(field.attributes.api_key);
      urlPrefix = field.attributes.appearance.parameters.url_prefix as string;
    });

    if (!fieldUsingThisPlugin) {
      return true;
    }

    const updatedFields = Object.keys(
      createOrUpdateItemPayload.data.attributes as object
    );

    let updatedFieldKey;

    (fieldUsingThisPlugin as Array<string>).forEach((field) => {
      if (updatedFields.includes(field)) {
        updatedFieldKey = field;
        return;
      }
    });

    if (!updatedFieldKey) {
      return true;
    }

    const client = buildClient({
      apiToken: ctx.currentUserAccessToken as string,
      environment: ctx.environment,
    });

    const recordBeforeUpdate = await client.items.find(
      (createOrUpdateItemPayload.data as any).id as string
    );

    const oldSlug = recordBeforeUpdate[updatedFieldKey];
    const newSlug = (createOrUpdateItemPayload.data.attributes as object)[
      updatedFieldKey
    ];

    updateSlugRedirects(
      urlPrefix,
      oldSlug as string,
      newSlug,
      recordBeforeUpdate.id,
      client
    );

    return true;
  },

  async onBeforeItemsPublish(publishItemPayload, ctx) {
    if (!ctx.plugin.attributes.parameters.onPublish) {
      return true;
    }

    let fieldUsingThisPlugin: Array<string> = [];
    let urlPrefix = '';

    (await ctx.loadFieldsUsingPlugin()).map((field) => {
      fieldUsingThisPlugin.push(field.attributes.api_key);
      urlPrefix = field.attributes.appearance.parameters.url_prefix as string;
    });

    if (!fieldUsingThisPlugin) {
      return true;
    }

    const updatedFields = Object.keys(
      publishItemPayload[0].attributes as object
    );

    let updatedFieldKey;

    (fieldUsingThisPlugin as Array<string>).forEach((field) => {
      if (updatedFields.includes(field)) {
        updatedFieldKey = field;
        return;
      }
    });

    if (!updatedFieldKey) {
      return true;
    }

    const client = buildClient({
      apiToken: ctx.currentUserAccessToken as string,
      environment: ctx.environment,
    });

    const recordBeforeUpdate = await client.items.find(
      (publishItemPayload[0] as any).id as string
    );

    const oldSlug = recordBeforeUpdate[updatedFieldKey];
    const newSlug = (publishItemPayload[0].attributes as object)[
      updatedFieldKey
    ];

    updateSlugRedirects(
      urlPrefix,
      newSlug as string,
      oldSlug as string,
      recordBeforeUpdate.id,
      client
    );

    return true;
  },

  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
});
