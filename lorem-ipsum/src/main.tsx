import {
  connect,
  type FieldDropdownActionsCtx,
  type ExecuteFieldDropdownActionCtx,
} from 'datocms-plugin-sdk';
import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import 'datocms-react-ui/styles.css';
import generateDummyText from './utils/generateDummyText';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  fieldDropdownActions(field, ctx: FieldDropdownActionsCtx) {
    const pluginParams = ctx.plugin.attributes.parameters;
    if (pluginParams && Array.isArray(pluginParams.autoApplyRules)) {
      for (const rule of pluginParams.autoApplyRules) {
        if (
          rule.fieldTypes &&
          rule.fieldTypes.includes(field.attributes.field_type)
        ) {
          try {
            const regex = new RegExp(rule.apiKeyRegexp);
            if (regex.test(field.attributes.api_key)) {
              return [
                {
                  id: 'loremIpsum',
                  label: 'Generate Lorem Ipsum',
                  icon: 'font',
                },
              ];
            }
          } catch (e) {
            // Skip rule if regex is invalid
          }
        }
      }
    }
    // Also add dropdown action if the manual field extension is applied
    if (
      field.attributes.appearance?.addons?.some(
        (addon) => addon.field_extension === 'loremIpsum'
      )
    ) {
      return [
        {
          id: 'loremIpsum',
          label: 'Generate Lorem Ipsum',
          icon: 'font',
        },
      ];
    }
    return [];
  },
  async executeFieldDropdownAction(
    actionId,
    ctx: ExecuteFieldDropdownActionCtx
  ) {
    if (actionId === 'loremIpsum') {
      const generated = generateDummyText(ctx.field);
      await ctx.setFieldValue(ctx.fieldPath, generated);
      ctx.notice('Lorem Ipsum generated!');
    }
  },
  manualFieldExtensions() {
    return [
      {
        id: 'loremIpsum',
        name: 'Lorem Ipsum',
        type: 'addon',
        fieldTypes: ['text', 'string', 'structured_text'],
        configurable: true,
      },
    ];
  },
});
