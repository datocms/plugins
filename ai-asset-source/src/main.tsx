import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import './styles/theme.css';
import AssetBrowser from './entrypoints/AssetBrowser';
import ConfigScreen from './entrypoints/ConfigScreen';
import { renderWithCanvas } from './utils/render';

const ASSET_SOURCE_ID = 'dall-e';

const imageGeneratorAssetSource = {
  id: ASSET_SOURCE_ID,
  name: 'Image Generator',
  icon: {
    type: 'svg' as const,
    viewBox: '0 0 24 24',
    content:
      '<rect x="3" y="5" width="18" height="14" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.75"></rect><circle cx="8.5" cy="10" r="1.5" fill="currentColor"></circle><path d="M21 16l-5.25-5.25a1 1 0 0 0-1.41 0L9 16l-1.75-1.75a1 1 0 0 0-1.41 0L3 17.09V19h18z" fill="currentColor"></path>',
  },
  modal: {
    width: 1200,
  },
};

connect({
  renderConfigScreen(ctx) {
    renderWithCanvas(<ConfigScreen ctx={ctx} />, ctx);
  },
  assetSources() {
    return [imageGeneratorAssetSource];
  },
  renderAssetSource(assetSourceId, ctx) {
    if (assetSourceId !== ASSET_SOURCE_ID) {
      return;
    }

    renderWithCanvas(<AssetBrowser />, ctx);
  },
});
