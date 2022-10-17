import { connect, RenderItemFormSidebarPanelCtx } from "datocms-plugin-sdk";
import { render } from "./utils/render";
import ConfigScreen from "./entrypoints/ConfigScreen";
import PreviewUrl from "./entrypoints/SidebarPanel";
import "datocms-react-ui/styles.css";
import { Parameters } from "./types";

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebarPanels: (_itemType, ctx) => {
    const { startOpen } = ctx.plugin.attributes.parameters as Parameters;

    return [
      {
        id: "webPreviews",
        label: "Web Previews",
        startOpen,
        placement: ["after", "actions"],
      },
    ];
  },
  renderItemFormSidebarPanel(
    _sidebarPanelId,
    ctx: RenderItemFormSidebarPanelCtx
  ) {
    render(<PreviewUrl ctx={ctx} />);
  },
});
