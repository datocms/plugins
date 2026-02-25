import {
  connect,
  ItemFormOutletsCtx,
  ItemType,
  RenderItemFormOutletCtx,
  RenderModalCtx,
} from "datocms-plugin-sdk";
import { render } from "./utils/render";
import ConfigScreen from "./entrypoints/ConfigScreen";
import "datocms-react-ui/styles.css";
import BinOutlet from "./entrypoints/BinOutlet";
import ErrorModal from "./entrypoints/ErrorModal";
import binCleanup from "./utils/binCleanup";
import { createDebugLogger, isDebugEnabled } from "./utils/debugLogger";

connect({
  async onBoot(ctx) {
    const pluginParameters = ctx.plugin.attributes.parameters;
    const debugLogger = createDebugLogger(
      isDebugEnabled(pluginParameters),
      "index.onBoot"
    );
    debugLogger.log("Plugin boot started");

    debugLogger.log("Running daily cleanup check");
    await binCleanup(ctx);
    debugLogger.log("Plugin boot completed");
  },
  renderConfigScreen(ctx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      "index.renderConfigScreen"
    );
    debugLogger.log("Rendering config screen");
    return render(<ConfigScreen ctx={ctx} />);
  },
  itemFormOutlets(model: ItemType, _ctx: ItemFormOutletsCtx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(_ctx.plugin.attributes.parameters),
      "index.itemFormOutlets"
    );
    if (model.attributes.api_key === "record_bin") {
      debugLogger.log("Registering item form outlet for record_bin model");
      return [
        {
          id: "recordBin",
          initialHeight: 0,
        },
      ];
    }

    debugLogger.log("Skipping item form outlet for model", {
      modelApiKey: model.attributes.api_key,
    });
    return [];
  },
  renderItemFormOutlet(outletId, ctx: RenderItemFormOutletCtx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      "index.renderItemFormOutlet"
    );
    if (outletId === "recordBin") {
      debugLogger.log("Rendering record bin outlet");
      render(<BinOutlet ctx={ctx} />);
      return;
    }

    debugLogger.log("Skipping outlet rendering", {
      outletId,
    });
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      "index.renderModal"
    );
    debugLogger.log("Rendering modal", { modalId });

    switch (modalId) {
      case "errorModal":
        return render(<ErrorModal ctx={ctx} />);
      default:
        debugLogger.warn("Received unknown modal id", { modalId });
        return undefined;
    }
  },
});
