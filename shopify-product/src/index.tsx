import { connect, RenderModalCtx, OnBootCtx } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import BrowseProductsModal from './components/BrowseProductsModal';
import FieldExtension from './entrypoints/FieldExtension';

import 'datocms-react-ui/styles.css';
import { isValidConfig, normalizeConfig } from './types';

connect({
  async onBoot(ctx: OnBootCtx) {
    if (
      !ctx.currentRole.meta.final_permissions.can_edit_schema ||
      isValidConfig(ctx.plugin.attributes.parameters)
    ) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    const someUpgraded = (
      await Promise.all(
        fields.map(async (field) => {
          if (
            field.attributes.appearance.editor !== ctx.plugin.id ||
            field.attributes.appearance.field_extension === 'shopifyProduct'
          ) {
            return false;
          }

          await ctx.updateFieldAppearance(field.id, [
            {
              operation: 'updateEditor',
              newFieldExtensionId: 'shopifyProduct',
            },
          ]);

          return true;
        }),
      )
    ).some((x) => x);

    await ctx.updatePluginParameters(
      normalizeConfig(ctx.plugin.attributes.parameters),
    );

    if (someUpgraded) {
      ctx.notice('Plugin upgraded successfully!');
    }
  },
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions() {
    return [
      {
        id: 'shopifyProduct',
        name: 'Shopify Product',
        type: 'editor',
        fieldTypes: ['string'],
      },
    ];
  },
  overrideFieldExtensions(field, ctx) {
    const config = normalizeConfig(ctx.plugin.attributes.parameters);

    if (field.attributes.field_type !== 'string') {
      return;
    }

    if (
      !config.autoApplyToFieldsWithApiKey ||
      !new RegExp(config.autoApplyToFieldsWithApiKey).test(
        field.attributes.api_key,
      )
    ) {
      return;
    }

    return {
      editor: { id: 'shopifyProduct' },
    };
  },
  renderFieldExtension(id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case 'browseProducts':
        return render(<BrowseProductsModal ctx={ctx} />);
    }
  },
});
