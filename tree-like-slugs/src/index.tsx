import {
  RenderFieldExtensionCtx,
  connect,
} from 'datocms-plugin-sdk';
import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import 'datocms-react-ui/styles.css';
import SlugExtension from './entrypoints/SlugExtension';
import updateAllChildrenSlugs from './utils/updateAllChildrenSlugs';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
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
  async onBeforeItemUpsert(createOrUpdateItemPayload, ctx) {
    if(!ctx.currentUserAccessToken) {
      await ctx.alert('This user does not have permission to run this plugin. It needs the currentUserAccessToken.');
      return true;
    }

    if (ctx.plugin.attributes.parameters.onPublish) {
      return true;
    }

    let fieldUsingThisPlugin: Array<string> = [];

    (await ctx.loadFieldsUsingPlugin()).forEach((field) => {
      fieldUsingThisPlugin.push(field.attributes.api_key);
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

    await updateAllChildrenSlugs(
      ctx.currentUserAccessToken,
      createOrUpdateItemPayload.data.relationships!.item_type!.data.id,
      createOrUpdateItemPayload.data.id!,
      updatedFieldKey,
      createOrUpdateItemPayload.data.attributes![updatedFieldKey] as string
    );

    return true;
  },
});
