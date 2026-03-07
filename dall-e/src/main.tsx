import { connect } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import 'datocms-react-ui/styles.css';
import AssetBrowser from './entrypoints/AssetBrowser';
import ConfigScreen from './entrypoints/ConfigScreen';
import { render } from './utils/render';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  assetSources() {
    return [
      {
        id: 'dall-e',
        name: 'Image Generator',
        icon: {
          type: 'svg',
          viewBox: '0 0 24 24',
          content:
            '<rect x="3" y="5" width="18" height="14" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.75"></rect><circle cx="8.5" cy="10" r="1.5" fill="currentColor"></circle><path d="M21 16l-5.25-5.25a1 1 0 0 0-1.41 0L9 16l-1.75-1.75a1 1 0 0 0-1.41 0L3 17.09V19h18z" fill="currentColor"></path>',
        },
        modal: {
          width: 1200,
        },
      },
    ];
  },
  renderAssetSource(_sourceId, ctx) {
    render(
      <Canvas ctx={ctx}>
        <AssetBrowser />
      </Canvas>,
    );
  },
});
