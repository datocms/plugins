import {
  connect,
  type OnBootCtx,
  type RenderModalCtx,
} from 'datocms-plugin-sdk';
import BrowseProductsModal from './components/BrowseProductsModal';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldExtension from './entrypoints/FieldExtension';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import {
  isConfigComplete,
  isValidConfig,
  parseAndNormalizeConfig,
} from './types';

const FIELD_EXTENSION_ID = 'shopifyProduct';

connect({
  async onBoot(ctx: OnBootCtx) {
    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    const rawParams = ctx.plugin.attributes.parameters;

    if (isValidConfig(rawParams)) {
      if (!isConfigComplete(rawParams)) {
        ctx.notice(
          'Shopify product plugin is missing configuration. Please fill in the settings.',
        );
      }
      return;
    }

    const normalized = parseAndNormalizeConfig(rawParams);

    const fields = await ctx.loadFieldsUsingPlugin();

    const someUpgraded = (
      await Promise.all(
        fields.map(async (field) => {
          if (
            field.attributes.appearance.editor !== ctx.plugin.id ||
            field.attributes.appearance.field_extension === FIELD_EXTENSION_ID
          ) {
            return false;
          }

          await ctx.updateFieldAppearance(field.id, [
            {
              operation: 'updateEditor',
              newFieldExtensionId: FIELD_EXTENSION_ID,
            },
          ]);

          return true;
        }),
      )
    ).some((x) => x);

    await ctx.updatePluginParameters(normalized);

    if (someUpgraded) {
      ctx.notice('Plugin upgraded successfully!');
    }

    if (!isConfigComplete(normalized)) {
      ctx.notice(
        'Shopify product plugin is missing configuration. Please fill in the settings.',
      );
    }
  },
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions() {
    return [
      {
        id: FIELD_EXTENSION_ID,
        name: 'Shopify Product',
        type: 'editor',
        fieldTypes: ['string', 'json'],
      },
    ];
  },
  overrideFieldExtensions(field, ctx) {
    const config = parseAndNormalizeConfig(ctx.plugin.attributes.parameters);

    if (!['string', 'json'].includes(field.attributes.field_type)) {
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
      editor: { id: FIELD_EXTENSION_ID },
    };
  },
  renderFieldExtension(_id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case 'browseProducts':
        return render(<BrowseProductsModal ctx={ctx} />);
    }
  },
});
