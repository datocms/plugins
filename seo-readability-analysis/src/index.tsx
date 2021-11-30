import { connect, FieldAppearanceChange } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import { Parameters } from './types';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldExtension from './entrypoints/FieldExtension';
import 'datocms-react-ui/styles.css';
import './style.sass';

const initialHeight = 200;

connect({
  async onBoot(ctx) {
    if (
      ctx.plugin.attributes.parameters
        .setSeoReadabilityAnalysisFieldExtensionId ||
      !ctx.currentRole.meta.final_permissions.can_edit_schema
    ) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    await Promise.all(
      fields.map(async (field) => {
        const { appearance } = field.attributes;
        const changes: FieldAppearanceChange[] = [];

        if (appearance.editor === ctx.plugin.id) {
          changes.push({
            operation: 'updateEditor',
            newFieldExtensionId: 'seoReadabilityAnalysis',
          });
        }

        if (changes.length > 0) {
          await ctx.updateFieldAppearance(field.id, changes);
        }
      }),
    );

    await ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      setSeoReadabilityAnalysisFieldExtensionId: true,
    });
  },
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions() {
    return [
      {
        name: 'SEO/Readability Analysis',
        id: 'seoReadabilityAnalysis',
        fieldTypes: ['json'],
        type: 'editor',
        initialHeight,
      },
    ];
  },
  overrideFieldExtensions(field, { plugin }) {
    const parameters = plugin.attributes.parameters as Parameters;

    if (
      'autoApplyToFieldsWithApiKey' in parameters &&
      parameters.autoApplyToFieldsWithApiKey &&
      field.attributes.api_key === parameters.autoApplyToFieldsWithApiKey &&
      field.attributes.field_type === 'json'
    ) {
      return {
        editor: {
          id: 'seoReadabilityAnalysis',
          initialHeight,
        },
      };
    }
  },
  renderFieldExtension(id, ctx) {
    return render(<FieldExtension ctx={ctx} />);
  },
});
