import {
  connect,
  FieldAppearanceChange,
  IntentCtx,
  OnBootCtx,
  RenderFieldExtensionCtx,
} from "datocms-plugin-sdk";
import "datocms-react-ui/styles.css";

connect({
  async onBoot(ctx: OnBootCtx) {
    if (ctx.plugin.attributes.parameters.migratedFromLegacyPlugin) {
      return;
    }

    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    await Promise.all(
      fields.map(async (field) => {
        const { appearance } = field.attributes;
        const changes: FieldAppearanceChange[] = [];
        appearance.addons.forEach((addon, index) => {
          changes.push({
            operation: "updateAddon",
            index,
            newFieldExtensionId: "disableField",
          });
        });
        await ctx.updateFieldAppearance(field.id, changes);
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
