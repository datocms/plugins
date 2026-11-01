import {
  connect,
  type RenderItemFormSidebarPanelCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import './frame.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import RecordDownloaderSidebar from './entrypoints/RecordDownloaderSidebar';
import { render } from './utils/render';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebarPanels() {
    return [
      {
        id: 'recordDownloader',
        label: 'Record downloader',
        startOpen: true,
      },
    ];
  },
  renderItemFormSidebarPanel(
    _sidebarPanelId,
    ctx: RenderItemFormSidebarPanelCtx,
  ) {
    render(<RecordDownloaderSidebar ctx={ctx} />);
  },
});
