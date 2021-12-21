import { connect } from "datocms-plugin-sdk";
import { render } from "./utils/render";
import ConfigScreen from "./entrypoints/ConfigScreen";
import FieldExtension from "./entrypoints/FieldExtension";
import { PluginAttributes } from "datocms-plugin-sdk/dist/types/SiteApiSchema";
import "datocms-react-ui/styles.css";

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
        const index = field.attributes.appearance.addons.findIndex(
          (addon) => addon.id === ctx.plugin.id && !addon.field_extension
        );

        if (index === -1) {
          return;
        }

        await ctx.updateFieldAppearance(field.id, [
          {
            operation: "updateAddon",
            index,
            newFieldExtensionId: "yandexTranslate",
          },
        ]);
      })
    );

    ctx.notice("Plugin upgraded successfully!");

    ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      upgradedFromLegacyPlugin: true,
    });
  },
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions() {
    return [
      {
        id: "yandexTranslate",
        name: "Yandex Translate",
        type: "addon",
        fieldTypes: ["text", "string"] as NonNullable<
          PluginAttributes["field_types"]
        >,
      },
    ];
  },
  renderFieldExtension(id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
});
