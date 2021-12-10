import { connect } from "datocms-plugin-sdk";
import { render } from "./utils/render";
import ConfigScreen from "./entrypoints/ConfigScreen";
import FieldExtension from "./entrypoints/FieldExtension";
import BrowseProductsModal from "./components/BrowseProductsModal";
import { PluginAttributes } from "datocms-plugin-sdk/dist/types/SiteApiSchema";
import { RenderModalCtx } from "datocms-plugin-sdk";
import { Provider } from "react-redux";
import store from "./components/store";
import "datocms-react-ui/styles.css";

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions() {
    return [
      {
        id: "commerceLayer",
        name: "Commerce Layer",
        type: "editor",
        fieldTypes: ["string"] as NonNullable<PluginAttributes["field_types"]>,
      },
    ];
  },
  renderFieldExtension(id, ctx) {
    render(
      <Provider store={store as any}>
        <FieldExtension ctx={ctx} />
      </Provider>
    );
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case "browseProducts":
        return render(
          <Provider store={store as any}>
            <BrowseProductsModal ctx={ctx} />
          </Provider>
        );
    }
  },
});
