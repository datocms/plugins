import { connect } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import FieldExtension from './entrypoints/FieldExtension';
import { isValidParams, normalizeParams } from './types';
import 'datocms-react-ui/styles.css';
import ConfigScreen from './entrypoints/ConfigScreen';

connect({
  async onBoot(ctx) {
    if (isValidParams(ctx.plugin.attributes.parameters)) {
      return;
    }

    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    const someUpgraded = (
      await Promise.all(
        fields.map(async (field) => {
          if (field.attributes.appearance.editor === ctx.plugin.id) {
            await ctx.updateFieldAppearance(field.id, [
              {
                operation: 'updateEditor',
                newFieldExtensionId: 'tagEditor',
              },
            ]);
            return true;
          }

          return false;
        }),
      )
    ).some((x) => !!x);

    ctx.updatePluginParameters(
      normalizeParams(ctx.plugin.attributes.parameters),
    );

    if (someUpgraded) {
      ctx.notice('Plugin upgraded successfully!');
    }
  },
  manualFieldExtensions() {
    return [
      {
        id: 'tagEditor',
        name: 'Tag Editor',
        type: 'editor',
        fieldTypes: ['json', 'string'],
      },
    ];
  },
  overrideFieldExtensions(field, { plugin }) {
    const parameters = normalizeParams(plugin.attributes.parameters);

    const foundRule = parameters.autoApplyRules.find(
      (rule) =>
        new RegExp(rule.apiKeyRegexp).test(field.attributes.api_key) &&
        rule.fieldTypes.includes(field.attributes.field_type as any),
    );

    if (!foundRule) {
      return;
    }

    return {
      editor: {
        id: 'tagEditor',
      },
    };
  },
  renderFieldExtension(id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
});
