import { FieldType, connect } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import FieldExtension from './entrypoints/FieldExtension';
import 'datocms-react-ui/styles.css';

const FIELDS_TYPES: FieldType[] = ['string', 'text', 'structured_text'];

connect({
  overrideFieldExtensions(field) {
    if (
      !FIELDS_TYPES.includes(
        field.attributes.field_type as FieldType,
      )
    ) {
      return;
    }

    if (!('length' in field.attributes.validators)) {
      return;
    }

    if (field.attributes.appearance.addons.find((addon) => addon.field_extension === 'character-count')) {
      return;
    }

    return {
      addons: [
        {
          id: 'character-count',
          initialHeight: 0,
        },
      ],
    };
  },
  manualFieldExtensions() {
    return [
      {
        id: 'character-count',
        name: 'Character counter',
        type: 'addon',
        fieldTypes: FIELDS_TYPES,
        configurable: false,
        initialHeight: 0,
      },
    ];
  },
  renderFieldExtension(_id, ctx) {
    return render(<FieldExtension ctx={ctx} />);
  },
});
