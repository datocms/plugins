import {
  connect,
  FieldAppearanceChange,
  IntentCtx,
  OnBootCtx,
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

type OldColor = {
  red: number;
  blue: number;
  green: number;
};

const convertOldColorToNew = ({ red, green, blue }: OldColor): string => {
  return `rgb(${red}, ${green}, ${blue})`;
};

connect({
  async onBoot(ctx: OnBootCtx) {
    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    if (ctx.plugin.attributes.parameters.migratedFromLegacyPlugin) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    await Promise.all(
      fields.map(async (field) => {
        const { appearance } = field.attributes;
        const changes: FieldAppearanceChange[] = [];

        if (appearance.editor === ctx.plugin.id) {
          changes.push({
            operation: "updateEditor",
            newFieldExtensionId: "starRating",
            newParameters: {
              ...appearance.parameters,
              starsColor: convertOldColorToNew(
                appearance.parameters.starsColor as OldColor
              ),
            },
          });
        }

        if (changes.length > 0) {
          await ctx.updateFieldAppearance(field.id, changes);
        }
      })
    );

    ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      migratedFromLegacyPlugin: true,
    });
  },
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
