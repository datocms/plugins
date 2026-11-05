import {
  connect,
  type FieldAppearanceChange,
  type RenderManualFieldExtensionConfigScreenCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import './frame.css';
import Canvas from 'datocms-react-ui/Canvas';
import { FieldExtension } from './entrypoints/FieldExtension';
import { PerFieldConfigScreen } from './entrypoints/PerFieldConfigScreen';
import {
  type GlobalParameters,
  isValidGlobalParameters,
  isValidParameters,
  type ValidGlobalParameters,
} from './types';
import normalizeParams from './utils/normalizeParams';
import { render } from './utils/render';

connect({
  async onBoot(ctx) {
    if (
      isValidGlobalParameters(
        ctx.plugin.attributes.parameters as GlobalParameters,
      )
    ) {
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

          for (const addon of field.attributes.appearance.addons) {
            if (addon.id !== ctx.plugin.id) {
              continue;
            }

            if (!isValidParameters(addon.parameters)) {
              changes.push({
                operation: 'updateAddon',
                index,
                newFieldExtensionId: 'conditionalFields',
                newParameters: normalizeParams(addon.parameters),
              });
            }
          }

          if (changes.length > 0) {
            await ctx.updateFieldAppearance(field.id, changes);
            return true;
          }

          return false;
        }),
      )
    ).some((x) => x);

    if (upgraded) {
      ctx.notice('Conditional fields settings upgraded.');
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
        fieldTypes: ['boolean', 'string'],
        configurable: true,
        initialHeight: 0,
      },
    ];
  },
  renderFieldExtension(_id, ctx) {
    // The addon draws nothing, so its frame keeps its initial height of 0
    render(
      <Canvas ctx={ctx} noAutoResizer>
        <FieldExtension ctx={ctx} />
      </Canvas>,
    );
  },
  renderManualFieldExtensionConfigScreen(
    _fieldExtensionId: string,
    ctx: RenderManualFieldExtensionConfigScreenCtx,
  ) {
    render(<PerFieldConfigScreen ctx={ctx} />);
  },
  validateManualFieldExtensionParameters(_fieldExtensionId, parameters) {
    // The settings screen shows old settings in the new shape
    const { targetFieldsApiKey } = isValidParameters(parameters)
      ? parameters
      : normalizeParams(parameters);
    return targetFieldsApiKey.length > 0
      ? {}
      : { targetFieldsApiKey: 'Pick at least one field.' };
  },
});
