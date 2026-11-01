import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import Canvas from 'datocms-react-ui/Canvas';
import { AssetLocalizationChecker } from './components/AssetLocalizationChecker.tsx';
import { render } from './utils/render';

connect({
  overrideFieldExtensions(field) {
    if (field.attributes.field_type === 'file') {
      return {
        addons: [
          {
            id: 'assetLocalizationChecker',
          },
        ],
      };
    }
  },
  renderFieldExtension(id, ctx) {
    if (id === 'assetLocalizationChecker') {
      render(
        <Canvas ctx={ctx}>
          <AssetLocalizationChecker ctx={ctx} />
        </Canvas>,
      );
    }
  },
});
