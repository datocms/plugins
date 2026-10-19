import { connect, type FieldType } from 'datocms-plugin-sdk';
import FieldExtension from './entrypoints/FieldExtension';
import SeoFieldExtension from './entrypoints/SeoFieldExtension';
import { SEO_LENGTH_VALIDATORS } from './lib/analyzeSeo';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';

const FIELDS_TYPES: FieldType[] = [
  'slug',
  'string',
  'text',
  'structured_text',
  'seo',
];

/** Validators that auto-attach the counter, per field type. */
const getLengthValidators = (fieldType: FieldType): readonly string[] =>
  fieldType === 'seo' ? SEO_LENGTH_VALIDATORS : ['length'];

connect({
  overrideFieldExtensions(field) {
    const fieldType = field.attributes.field_type as FieldType;

    if (!FIELDS_TYPES.includes(fieldType)) {
      return;
    }

    if (
      !getLengthValidators(fieldType).some(
        (validator) => validator in field.attributes.validators,
      )
    ) {
      return;
    }

    if (
      field.attributes.appearance.addons.find(
        (addon) => addon.field_extension === 'character-count',
      )
    ) {
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
    if (ctx.field.attributes.field_type === 'seo') {
      return render(<SeoFieldExtension ctx={ctx} />);
    }

    return render(<FieldExtension ctx={ctx} />);
  },
});
