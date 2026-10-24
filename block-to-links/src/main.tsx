import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import Canvas from 'datocms-react-ui/Canvas';
import ConfigScreen from './entrypoints/ConfigScreen';
import { render } from './utils/render';

connect({
  renderConfigScreen(ctx) {
    return render(
      <Canvas ctx={ctx}>
        <ConfigScreen ctx={ctx} />
      </Canvas>,
    );
  },
});
