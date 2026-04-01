import { connect, type OnBootCtx } from 'datocms-plugin-sdk';
import FieldExtension from './entrypoints/FieldExtension';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';

connect({
  async onBoot(ctx: OnBootCtx) {
    if (
      !ctx.currentRole.meta.final_permissions.can_edit_schema ||
      ctx.plugin.attributes.parameters.migratedFromLegacyPlugin
    ) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    await Promise.all(
      fields.map(async (field) => {
        if (field.attributes.appearance.editor === ctx.plugin.id) {
          await ctx.updateFieldAppearance(field.id, [
            {
              operation: 'updateEditor',
              newFieldExtensionId: 'tinymce',
            },
          ]);
        }
      }),
    );

    await ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      migratedFromLegacyPlugin: true,
    });

    ctx.notice('Plugin upgraded successfully!');
  },
  manualFieldExtensions() {
    return [
      {
        id: 'tinymce',
        name: 'TinyMCE',
        type: 'editor',
        fieldTypes: ['text'],
      },
    ];
  },
  renderFieldExtension(_id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
});
