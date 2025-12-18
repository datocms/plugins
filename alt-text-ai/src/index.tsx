import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import 'datocms-react-ui/styles.css';
import { connect, Field, RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import AltTextAIButton from './entrypoints/AltTextAIButton';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  overrideFieldExtensions(field: Field) {
    if (
      field.attributes.field_type === 'gallery' ||
      field.attributes.field_type === 'file'
    ) {
      return {
        addons: [{ id: 'altTextAI' }],
      };
    }
  },
  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    switch (fieldExtensionId) {
      case 'altTextAI':
        return render(<AltTextAIButton ctx={ctx} />);
    }
  },
});
