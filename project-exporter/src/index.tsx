import {
  connect,
  type RenderItemFormSidebarPanelCtx,
} from 'datocms-plugin-sdk';
import ConfigScreen from './entrypoints/ConfigScreen';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import RecordDownloaderSidebar from './entrypoints/RecordDownloaderSidebar';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebarPanels() {
    return [
      {
        id: 'recordDownloader',
        label: 'Record Downloader',
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
