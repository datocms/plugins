import { connect } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import FieldExtension from './entrypoints/FieldExtension';
import Modal from './entrypoints/Modal';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import './frame.css';

connect({
  manualFieldExtensions() {
    return [
      {
        id: 'table',
        type: 'editor',
        name: 'Table',
        fieldTypes: ['json'],
      },
    ];
  },
  renderFieldExtension(_id, ctx) {
    render(
      <Canvas ctx={ctx}>
        <FieldExtension ctx={ctx} />
      </Canvas>,
    );
  },
  renderModal(_id, ctx) {
    render(
      <Canvas ctx={ctx}>
        <Modal ctx={ctx} />
      </Canvas>,
    );
  },
});
