import {
  connect,
  IntentCtx,
  ItemType,
  RenderItemFormOutletCtx,
  RenderModalCtx,
} from "datocms-plugin-sdk";
import { render } from "./utils/render";
import ConfigScreen from "./entrypoints/ConfigScreen";
import "datocms-react-ui/styles.css";
import BinOutlet from "./entrypoints/BinOutlet";
import InstallationModal from "./entrypoints/InstallationModal";
import PreInstallConfig from "./entrypoints/PreInstallConfig";
import ErrorModal from "./entrypoints/ErrorModal";
import binCleanup from "./utils/binCleanup";

connect({
  async onBoot(ctx) {
    if (
      !ctx.plugin.attributes.parameters.installationState &&
      !ctx.plugin.attributes.parameters.hasBeenPrompted
    ) {
      ctx.updatePluginParameters({ hasBeenPrompted: true });
      await ctx.openModal({
        id: "installationModal",
        title: "Record Bin setup",
        width: "m",
        parameters: { foo: "bar" },
        closeDisabled: true,
      });
      return;
    }
    await binCleanup(ctx);
  },
  renderConfigScreen(ctx) {
    if (ctx.plugin.attributes.parameters.installationState === "installed") {
      return render(<ConfigScreen ctx={ctx} />);
    }
    return render(<PreInstallConfig ctx={ctx} />);
  },
  itemFormOutlets(model: ItemType, ctx: IntentCtx) {
    if (model.attributes.api_key === "record_bin") {
      return [
        {
          id: "recordBin",
          initialHeight: 0,
        },
      ];
    }
    return [];
  },
  renderItemFormOutlet(outletId, ctx: RenderItemFormOutletCtx) {
    if (
      outletId === "recordBin" &&
      ctx.plugin.attributes.parameters.installationState === "installed"
    ) {
      render(<BinOutlet ctx={ctx} />);
    }
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case "installationModal":
        return render(<InstallationModal ctx={ctx} />);
      case "errorModal":
        return render(<ErrorModal ctx={ctx} />);
    }
  },
});
