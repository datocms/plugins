import { connect } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import 'datocms-react-ui/styles.css';
import { Config, ValidFieldType } from './types';
import { PluginAttributes } from 'datocms-plugin-sdk/dist/types/SiteApiSchema';
import FieldExtension from './entrypoints/FieldExtension';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions() {
    return [
      {
        id: 'loremIpsum',
        name: 'Lorem Ipsum',
        type: 'addon',
        fieldTypes: ['text', 'string', 'structured_text'] as NonNullable<
          PluginAttributes['field_types']
        >,
        configurable: true,
      },
    ];
  },
  overrideFieldExtensions(field, { plugin }) {
    const parameters = plugin.attributes.parameters as Config;

    if (!('autoApplyRules' in parameters)) {
      return;
    }
    const foundRule = parameters.autoApplyRules.find(
      (rule) =>
        new RegExp(rule.apiKeyRegexp).test(field.attributes.api_key) &&
        rule.fieldTypes.includes(field.attributes.field_type as ValidFieldType),
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
  }
});
