import { connect } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import { Parameters } from './types';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldExtension from './entrypoints/FieldExtension';
import 'datocms-react-ui/styles.css';
import './style.sass';

const initialHeight = 200;

connect({
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
