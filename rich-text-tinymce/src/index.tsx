import { connect } from "datocms-plugin-sdk";
import { render } from "./utils/render";
import { PluginAttributes } from "datocms-plugin-sdk/dist/types/SiteApiSchema";
import FieldExtension from "./entrypoints/FieldExtension";
import ConfigScreen from "./entrypoints/ConfigScreen";
import "datocms-react-ui/styles.css";

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions() {
    return [
      {
        id: "tinyMce",
        name: "Tiny MCE",
        type: "editor",
        fieldTypes: ["text"] as NonNullable<PluginAttributes["field_types"]>,
      },
    ];
  },
  renderFieldExtension(id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
});
