import { connect, type FieldAppearanceChange } from 'datocms-plugin-sdk';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldExtension from './entrypoints/FieldExtension';
import {
  isValidParameters,
  normalizeParams,
  type ValidFieldType,
} from './types';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';

function isValidFieldType(value: string): value is ValidFieldType {
  return value === 'string' || value === 'text';
}

connect({
  async onBoot(ctx) {
    if (isValidParameters(ctx.plugin.attributes.parameters)) {
      return;
    }

    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    const someFieldUpgraded = (
      await Promise.all(
        fields.map(async (field, index) => {
          const changes: FieldAppearanceChange[] = [];

          for (const addon of field.attributes.appearance.addons) {
            if (addon.id !== ctx.plugin.id || addon.field_extension) {
              continue;
            }

            changes.push({
              operation: 'updateAddon',
              index,
              newFieldExtensionId: 'yandexTranslate',
            });
          }

          if (changes.length > 0) {
            await ctx.updateFieldAppearance(field.id, changes);
            return true;
          }

          return false;
        }),
      )
    ).some((x) => x);

    ctx.updatePluginParameters(
      normalizeParams(ctx.plugin.attributes.parameters),
    );

    if (someFieldUpgraded) {
      ctx.notice('Plugin upgraded successfully!');
    }
  },
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions() {
    return [
      {
        id: 'yandexTranslate',
        name: 'Yandex Translate',
        type: 'addon',
        fieldTypes: ['text', 'string'],
      },
    ];
  },
  overrideFieldExtensions(field, { plugin }) {
    const parameters = normalizeParams(plugin.attributes.parameters);

    const foundRule = parameters.autoApplyRules.find(
      (rule) =>
        new RegExp(rule.apiKeyRegexp).test(field.attributes.api_key) &&
        isValidFieldType(field.attributes.field_type) &&
        rule.fieldTypes.includes(field.attributes.field_type) &&
        field.attributes.localized,
    );

    if (!foundRule) {
      return;
    }

    return {
      addons: [
        {
          id: 'loremIpsum',
        },
      ],
    };
  },
  renderFieldExtension(_id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
});
