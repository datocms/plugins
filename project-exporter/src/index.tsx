import { RenderItemFormSidebarPanelCtx, connect } from "datocms-plugin-sdk";
import { render } from "./utils/render";
import ConfigScreen from "./entrypoints/ConfigScreen";
import "datocms-react-ui/styles.css";
import RecordDownloaderSidebar from "./entrypoints/RecordDownloaderSidebar";

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebarPanels() {
    return [
      {
        id: "recordDownloader",
        label: "Record Downloader",
        startOpen: true,
      },
    ];
  },
  renderItemFormSidebarPanel(
    sidebarPanelId,
    ctx: RenderItemFormSidebarPanelCtx
  ) {
    render(<RecordDownloaderSidebar ctx={ctx} />);
  },
});
