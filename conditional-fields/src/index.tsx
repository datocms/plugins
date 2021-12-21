import {
  connect,
  RenderManualFieldExtensionConfigScreenCtx,
} from "datocms-plugin-sdk";
import { render } from "./utils/render";
import "datocms-react-ui/styles.css";
import { ValidFieldType } from "./types";
import { PluginAttributes } from "datocms-plugin-sdk/dist/types/SiteApiSchema";
import { PerFieldConfigScreen } from "./entrypoints/PerFieldConfigScreen";
import { FieldExtension } from "./entrypoints/FieldExtension";

const allowedFieldTypes = ["boolean"] as NonNullable<
  PluginAttributes["field_types"]
>;

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
            newFieldExtensionId: "conditionalFields",
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
  manualFieldExtensions() {
    return [
      {
        id: "conditionalFields",
        name: "Conditional fields",
        type: "addon",
        fieldTypes: allowedFieldTypes,
        configurable: true,
      },
    ];
  },
  overrideFieldExtensions(field, { plugin }) {
    if (
      !allowedFieldTypes.includes(field.attributes.field_type as ValidFieldType)
    ) {
      return;
    }

    return {
      addons: [
        {
          id: "conditionalFields",
        },
      ],
    };
  },
  renderFieldExtension(id, ctx) {
    render(<FieldExtension ctx={ctx} />);
  },
  renderManualFieldExtensionConfigScreen(
    fieldExtensionId: string,
    ctx: RenderManualFieldExtensionConfigScreenCtx
  ) {
    render(<PerFieldConfigScreen ctx={ctx} />);
  },
});
