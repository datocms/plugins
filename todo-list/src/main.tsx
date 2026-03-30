import { connect, type RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import FieldExtension from './entrypoints/FieldExtension';
import { render } from './utils/render';

connect({
  manualFieldExtensions() {
    return [
      {
        id: 'todoList',
        name: 'Todo list',
        type: 'editor',
        fieldTypes: ['json'],
        initialHeight: 320,
      },
    ];
  },

  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    if (fieldExtensionId === 'todoList') {
      render(<FieldExtension ctx={ctx} />);
    }
  },
});
