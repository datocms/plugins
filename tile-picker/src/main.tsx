import type {
  FieldAppearanceChange,
  ManualFieldExtensionsCtx,
  RenderConfigScreenCtx,
  RenderFieldExtensionCtx,
  RenderManualFieldExtensionConfigScreenCtx,
} from 'datocms-plugin-sdk';
import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import './frame.css';
import Canvas from 'datocms-react-ui/Canvas';
import FieldConfigScreen from './entrypoints/FieldConfigScreen';
import GlobalConfigScreen from './entrypoints/GlobalConfigScreen';
import VisualSelect from './entrypoints/VisualSelect';
import {
  isValidFieldParameters,
  isValidPluginParameters,
  normalizeFieldParameters,
  normalizePluginParameters,
} from './lib/types';
import { validateFieldConfig } from './lib/validators';
import { render } from './utils/render';

connect({
  async onBoot(ctx) {
    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) return;

    if (!isValidPluginParameters(ctx.plugin.attributes.parameters)) {
      await ctx.updatePluginParameters(
        normalizePluginParameters(ctx.plugin.attributes.parameters),
      );
    }

    const fields = await ctx.loadFieldsUsingPlugin();
    const someUpgraded = (
      await Promise.all(
        fields.map(async (field) => {
          if (isValidFieldParameters(field.attributes.appearance.parameters))
            return false;
          const changes: FieldAppearanceChange[] = [
            {
              operation: 'updateEditor',
              newFieldExtensionId: 'visualSelect',
              newParameters: normalizeFieldParameters(
                field.attributes.appearance.parameters,
              ),
            },
          ];
          await ctx.updateFieldAppearance(field.id, changes);
          return true;
        }),
      )
    ).some(Boolean);

    if (someUpgraded) ctx.notice('Tile Picker settings upgraded.');
  },

  renderConfigScreen(ctx: RenderConfigScreenCtx) {
    render(
      <Canvas ctx={ctx}>
        <GlobalConfigScreen ctx={ctx} />
      </Canvas>,
    );
  },

  manualFieldExtensions(_ctx: ManualFieldExtensionsCtx) {
    return [
      {
        id: 'visualSelect',
        name: 'Tile Picker',
        type: 'editor',
        fieldTypes: ['text', 'string'],
        configurable: true,
      },
    ];
  },

  validateManualFieldExtensionParameters(
    _fieldExtensionId: string,
    parameters: Record<string, unknown>,
  ) {
    const errors: Record<string, string> = {};
    const normalized = normalizeFieldParameters(parameters);
    const result = validateFieldConfig(normalized.config);
    if (result.type === 'error') {
      errors.config = result.message;
    }
    // A grid needs a whole number of columns, 1 or more
    const presentation = normalized.config.presentation;
    const columns = presentation?.columns;
    if (
      presentation?.type !== 'carousel' &&
      columns !== undefined &&
      !(Number.isInteger(columns) && columns >= 1)
    ) {
      errors.columns = 'Enter a whole number, 1 or more.';
    }
    return errors;
  },

  renderFieldExtension(
    _fieldExtensionId: string,
    ctx: RenderFieldExtensionCtx,
  ) {
    render(
      <Canvas ctx={ctx}>
        <VisualSelect ctx={ctx} />
      </Canvas>,
    );
  },

  renderManualFieldExtensionConfigScreen(
    _fieldExtensionId: string,
    ctx: RenderManualFieldExtensionConfigScreenCtx,
  ) {
    render(
      <Canvas ctx={ctx}>
        <FieldConfigScreen ctx={ctx} />
      </Canvas>,
    );
  },
});
