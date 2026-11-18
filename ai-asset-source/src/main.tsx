import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import AssetBrowser from './entrypoints/AssetBrowser';
import ConfigScreen from './entrypoints/ConfigScreen';
import { renderWithCanvas } from './utils/render';

const ASSET_SOURCE_ID = 'dall-e';

const imageGeneratorAssetSource = {
  id: ASSET_SOURCE_ID,
  name: 'AI Asset Source',
  icon: 'image' as const,
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
