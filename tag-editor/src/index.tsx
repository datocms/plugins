import { connect } from "datocms-plugin-sdk";
import { render } from "./utils/render";
import "datocms-react-ui/styles.css";
import { PluginAttributes } from "datocms-plugin-sdk/dist/types/SiteApiSchema";
import FieldExtension from "./entrypoints/FieldExtension";

connect({
  async onBoot(ctx) {
    if (ctx.plugin.attributes.parameters.upgradedFromLegacyPlugin) {
      return;
    }

    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    await Promise.all(
      fields.map(async (field) => {
        if (
          field.attributes.appearance.editor === ctx.plugin.id &&
          field.attributes.appearance.field_extension === "tagEditor"
        ) {
          await ctx.updateFieldAppearance(field.id, [
            {
              operation: "updateEditor",
              newFieldExtensionId: "tagEditor",
            },
          ]);
        }
      })
    );

    ctx.notice("Plugin upgraded successfully!");

    ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      upgradedFromLegacyPlugin: true,
    });
  },
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
