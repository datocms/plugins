import { connect } from 'datocms-plugin-sdk';
import { OnBootCtx } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldExtension from './entrypoints/FieldExtension';
import BrowseProductsModal from './components/BrowseProductsModal';
import { RenderModalCtx } from 'datocms-plugin-sdk';
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
            field.attributes.appearance.field_extension === 'commerceLayer'
          ) {
            return false;
          }

          await ctx.updateFieldAppearance(field.id, [
            {
              operation: 'updateEditor',
              newFieldExtensionId: 'commerceLayer',
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
        id: 'commerceLayer',
        name: 'Commerce Layer',
        type: 'editor',
        fieldTypes: ['string'],
      },
    ];
  },
  renderFieldExtension(id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    return render(<BrowseProductsModal ctx={ctx} />);
  },
});
