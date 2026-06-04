import { connect } from "datocms-plugin-sdk";
import type {
  ManualFieldExtensionsCtx,
  RenderManualFieldExtensionConfigScreenCtx,
  RenderFieldExtensionCtx,
  RenderConfigScreenCtx,
} from "datocms-plugin-sdk";
import { isString } from "remeda";
import "datocms-react-ui/styles.css";
import { render } from "./utils/render";
import FieldConfigScreen from "./entrypoints/FieldConfigScreen";
import VisualSelect from "./entrypoints/VisualSelect";
import GlobalConfigScreen from "./entrypoints/GlobalConfigScreen";
import { validateFieldConfig } from "./lib/validators";
import type { FieldParameters } from "./lib/types";
import { EMPTY_LENGTH } from "./constants";

connect({
  renderConfigScreen(ctx: RenderConfigScreenCtx) {
    render(<GlobalConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions(_ctx: ManualFieldExtensionsCtx) {
    return [
      {
        id: "visualSelect",
        name: "Visual Select",
        type: "editor",
        fieldTypes: ["text", "string"],
        configurable: true,
      },
    ];
  },
  validateManualFieldExtensionParameters(
    _fieldExtensionId: string,
    parameters: Record<string, unknown>,
  ) {
    const errors: Record<string, string> = {};
    const { collection } = parameters as FieldParameters;

    if (!isString(collection) || collection.length === EMPTY_LENGTH) {
      errors.collection = "Configuration is required";
      return errors;
    }

    try {
      const result = validateFieldConfig(JSON.parse(collection));
      if (result.type === "error") {
        errors.collection = result.message;
      }
    } catch {
      errors.collection = "Invalid JSON";
    }

    return errors;
  },
  renderFieldExtension(_fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    render(<VisualSelect ctx={ctx} />);
  },
  renderManualFieldExtensionConfigScreen(
    _fieldExtensionId: string,
    ctx: RenderManualFieldExtensionConfigScreenCtx,
  ) {
    render(<FieldConfigScreen ctx={ctx} />);
  },
});
