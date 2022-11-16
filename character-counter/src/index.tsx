import { connect } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import FieldExtension from './entrypoints/FieldExtension';
import 'datocms-react-ui/styles.css';

connect({
  overrideFieldExtensions(field, ctx) {
    if (
      !['string', 'text', 'structured_text'].includes(
        field.attributes.field_type,
      )
    ) {
      return;
    }

    if (!('length' in field.attributes.validators)) {
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
  renderFieldExtension(id, ctx) {
    return render(<FieldExtension ctx={ctx} />);
  },
});
