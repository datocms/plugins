import {
  connect,
  FieldAppearanceChange,
  RenderManualFieldExtensionConfigScreenCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import { PerFieldConfigScreen } from './entrypoints/PerFieldConfigScreen';
import { FieldExtension } from './entrypoints/FieldExtension';
import {
  isValidGlobalParameters,
  isValidParameters,
  ValidGlobalParameters,
} from './types';
import { render } from './utils/render';
import normalizeParams from './utils/normalizeParams';

connect({
  async onBoot(ctx) {
    if (isValidGlobalParameters(ctx.plugin.attributes.parameters)) {
      return;
    }

    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    const upgraded = (
      await Promise.all(
        fields.map(async (field, index) => {
          const changes: FieldAppearanceChange[] = [];

          field.attributes.appearance.addons.forEach((addon) => {
            if (addon.id !== ctx.plugin.id) {
              return;
            }

            if (!isValidParameters(addon.parameters)) {
              changes.push({
                operation: 'updateAddon',
                index,
                newFieldExtensionId: 'conditionalFields',
                newParameters: normalizeParams(addon.parameters),
              });
            }
          });

          if (changes.length > 0) {
            await ctx.updateFieldAppearance(field.id, changes);
            return true;
          }

          return false;
        }),
      )
    ).some((x) => x);

    if (upgraded) {
      ctx.notice('Plugin upgraded successfully!');
    }

    ctx.updatePluginParameters({
      parametersVersion: '2',
    } as ValidGlobalParameters);
  },
  manualFieldExtensions() {
    return [
      {
        id: 'conditionalFields',
        name: 'Conditional fields',
        type: 'addon',
        fieldTypes: ['boolean'],
        configurable: true,
        initialHeight: 0,
      },
    ];
  },
  renderFieldExtension(id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
  renderManualFieldExtensionConfigScreen(
    fieldExtensionId: string,
    ctx: RenderManualFieldExtensionConfigScreenCtx,
  ) {
    render(<PerFieldConfigScreen ctx={ctx} />);
  },
});
