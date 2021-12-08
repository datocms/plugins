import {
  connect,
  IntentCtx,
  RenderFieldExtensionCtx,
  RenderManualFieldExtensionConfigScreenCtx,
} from "datocms-plugin-sdk";
import { render } from "./utils/render";
import "datocms-react-ui/styles.css";
import StarRatingEditor from "./entrypoints/StarRatingEditor";
import React from "react";
import ReactDOM from "react-dom";
import StarRatingConfigScreen from "./entrypoints/StarRatingConfigScreen";

const isValidCSSColor = (strColor: string) => {
  const s = new Option().style;
  s.color = strColor;
  return s.color !== "";
};

connect({
  manualFieldExtensions(ctx: IntentCtx) {
    return [
      {
        id: "starRating",
        name: "Star rating",
        type: "editor",
        fieldTypes: ["integer"],
        configurable: true,
      },
    ];
  },
  renderManualFieldExtensionConfigScreen(
    fieldExtensionId: string,
    ctx: RenderManualFieldExtensionConfigScreenCtx
  ) {
    ReactDOM.render(
      <React.StrictMode>
        <StarRatingConfigScreen ctx={ctx} />
      </React.StrictMode>,
      document.getElementById("root")
    );
  },
  validateManualFieldExtensionParameters(
    fieldExtensionId: string,
    parameters: Record<string, any>
  ) {
    const errors: Record<string, string> = {};
    if (
      isNaN(parseInt(parameters.maxRating)) ||
      parameters.maxRating < 2 ||
      parameters.maxRating > 10
    ) {
      errors.maxRating = "Rating must be between 2 and 10!";
    }
    if (!parameters.starsColor || !isValidCSSColor(parameters.starsColor)) {
      errors.starsColor = "Invalid CSS color!";
    }
    return errors;
  },
  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    if (fieldExtensionId === "starRating") {
      return render(<StarRatingEditor ctx={ctx} />);
    }
  },
});
