import {
  connect,
  InitPropertiesAndMethods,
  ModelBlock,
  OnBootCtx,
  RenderConfigScreenCtx,
  RenderItemFormOutletCtx,
} from "datocms-plugin-sdk";
import { render } from "./utils/render";
import "datocms-react-ui/styles.css";
import AutoSave from "./entrypoints/AutoSave";
import ConfigScreen, { PluginParametersType } from "./entrypoints/ConfigScreen";

connect({
  async onBoot(ctx: OnBootCtx) {
    if (ctx.plugin.attributes.parameters.parametersHaveBeenSet) {
      return;
    }
    await ctx.updatePluginParameters({
      modelsWithAutoSave: [],
      autoSaveInterval: 5,
      showNotification: false,
      parametersHaveBeenSet: true,
    });
  },
  itemFormOutlets(itemType: ModelBlock, ctx: InitPropertiesAndMethods) {
    return [
      {
        id: "auto_save",
        initialHeight: 0,
      },
    ];
  },
  renderItemFormOutlet(outletId: string, ctx: RenderItemFormOutletCtx) {
    const pluginParameters = ctx.plugin.attributes
      .parameters as PluginParametersType;
    if (outletId === "auto_save") {
      const isActivatedOnThisModel = pluginParameters.selectedModels.find(
        (item) => item.value === ctx.itemType.attributes.api_key
      );
      if (isActivatedOnThisModel) {
        render(<AutoSave ctx={ctx} />);
      }
    }
  },
  renderConfigScreen(ctx: RenderConfigScreenCtx) {
    render(<ConfigScreen ctx={ctx} />);
  },
});
