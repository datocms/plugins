import {
  connect,
  FullConnectParameters,
  IntentCtx,
  ItemFormSidebarPanel,
  ItemType,
  RenderItemFormSidebarPanelCtx,
} from "datocms-plugin-sdk";
import { render } from "./utils/render";
import ConfigScreen from "./entrypoints/ConfigScreen";
import PreviewUrl from "./entrypoints/SidebarPanel";
import "datocms-react-ui/styles.css";
import { Parameters } from "./types";

type Merge<T, R> = Omit<T, keyof R> & R;

type AsyncConnectParameters = {
  itemFormSidebarPanels: (
    itemType: ItemType,
    ctx: IntentCtx
  ) => Promise<ItemFormSidebarPanel[]>;
};

const connectAsync = connect as (
  configuration?: Partial<Merge<FullConnectParameters, AsyncConnectParameters>>
) => Promise<void>;

connectAsync({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebarPanels: async (itemType, ctx) => {
    const { previewModelsEndpoint, startOpen } = ctx.plugin.attributes
      .parameters as Parameters;

    if (previewModelsEndpoint) {
      const url = new URL(previewModelsEndpoint);

      const request = await fetch(url.toString());

      if (request.status !== 200) {
        throw new Error(`Endpoint returned status ${request.status}`);
      }

      try {
        const response = await request.json();

        if (!response.model_api_keys) {
          throw new Error(`Please provide a valid payload`);
        }

        if (!response.model_api_keys.includes(itemType.attributes.api_key)) {
          return [];
        }
      } catch (e) {
        console.error(`Web Previews link plugin error!`, e);
      }
    }

    return [
      {
        id: "webPreviews",
        label: "Web previews",
        startOpen,
        placement: ["after", "actions"],
      },
    ] as ItemFormSidebarPanel[];
  },
  renderItemFormSidebarPanel(
    _sidebarPanelId,
    ctx: RenderItemFormSidebarPanelCtx
  ) {
    render(<PreviewUrl ctx={ctx} />);
  },
});
