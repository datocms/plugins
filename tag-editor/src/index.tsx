import { connect } from "datocms-plugin-sdk";
import { render } from "./utils/render";
import "datocms-react-ui/styles.css";
import { PluginAttributes } from "datocms-plugin-sdk/dist/types/SiteApiSchema";
import FieldExtension from "./entrypoints/FieldExtension";

connect({
  manualFieldExtensions() {
    return [
      {
        id: "tagEditor",
        name: "Tag Editor",
        type: "editor",
        fieldTypes: ["json", "string"] as NonNullable<
          PluginAttributes["field_types"]
        >,
      },
    ];
  },
  renderFieldExtension(id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
});
