import { connect } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { render } from './utils/render';
import AssetBrowser from './entrypoints/AssetBrowser';
import 'datocms-react-ui/styles.css';

connect({
  assetSources() {
    return [
      {
        id: 'unsplash',
        name: 'Unsplash',
        icon: {
          type: 'svg',
          viewBox: '0 0 448 512',
          content:
            '<path fill="currentColor" d="M448,230.17V480H0V230.17H141.13V355.09H306.87V230.17ZM306.87,32H141.13V156.91H306.87Z" class=""></path>',
        },
        modal: {
          width: 2000,
        },
      },
    ];
  },
  renderAssetSource(sourceId, ctx) {
    render(
      <Canvas ctx={ctx}>
        <AssetBrowser />
      </Canvas>,
    );
  },
});
