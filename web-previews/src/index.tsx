import { connect, RenderItemFormSidebarCtx, RenderItemFormSidebarPanelCtx } from "datocms-plugin-sdk";
import { render } from "./utils/render";
import ConfigScreen from "./entrypoints/ConfigScreen";
import SidebarPanel from "./entrypoints/SidebarPanel";
import SidebarFrame from "./entrypoints/SidebarFrame";
import "datocms-react-ui/styles.css";
import { Parameters } from "./types";

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebarPanels(_itemType, ctx) {
    const { startOpen } = ctx.plugin.attributes.parameters as Parameters;

    return [
      {
        id: "webPreviews",
        label: "Web previews",
        startOpen,
        placement: ["after", "actions"],
      },
    ];
  },
  renderItemFormSidebarPanel(
    _sidebarPanelId,
    ctx: RenderItemFormSidebarPanelCtx
  ) {
    render(<SidebarPanel ctx={ctx} />);
  },
  itemFormSidebars() {
    return [
      {
        id: "webPreviews",
        label: "Side-by-side web previews",
        preferredWidth: 900,
      },
    ];
  },
  renderItemFormSidebar(
    _sidebarId,
    ctx: RenderItemFormSidebarCtx
  ) {
    render(<SidebarFrame ctx={ctx} />);
  },
});
