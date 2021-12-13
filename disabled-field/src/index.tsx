import {
  connect,
  IntentCtx,
  RenderFieldExtensionCtx,
} from "datocms-plugin-sdk";
import "datocms-react-ui/styles.css";

connect({
  manualFieldExtensions(ctx: IntentCtx) {
    return [
      {
        id: "disableField",
        name: "Disable Field",
        type: "addon",
        fieldTypes: [
          "boolean",
          "color",
          "date",
          "date_time",
          "file",
          "float",
          "gallery",
          "integer",
          "json",
          "lat_lon",
          "link",
          "links",
          "rich_text",
          "seo",
          "slug",
          "string",
          "text",
          "video",
        ],
      },
    ];
  },
  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    if (fieldExtensionId === "disableField") {
      ctx.disableField(ctx.fieldPath, true);
    }
  },
});
