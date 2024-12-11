import { connect } from "datocms-plugin-sdk";
import { render } from "./utils/render";
import FieldExtension from "./entrypoints/FieldExtension";
import Modal from "./entrypoints/Modal";
import "datocms-react-ui/styles.css";

connect({
  manualFieldExtensions() {
    return [
      {
        id: "table",
        type: "editor",
        name: "Table",
        fieldTypes: ["json"],
      },
    ];
  },
  renderFieldExtension(_id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
  renderModal(_id, ctx) {
    render(<Modal ctx={ctx} />);
  },
});
