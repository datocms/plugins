import { connect } from "datocms-plugin-sdk";
import { render } from "./utils/render";
import ConfigScreen from "./entrypoints/ConfigScreen";
import FieldExtension from "./entrypoints/FieldExtension";
import BrowseProductsModal from "./components/BrowseProductsModal";
import { PluginAttributes } from "datocms-plugin-sdk/dist/types/SiteApiSchema";
import { RenderModalCtx, OnBootCtx } from "datocms-plugin-sdk";
import { Provider } from "react-redux";
import store from "./components/store";

import "datocms-react-ui/styles.css";

connect({
  async onBoot(ctx: OnBootCtx) {
    if (
      !ctx.currentRole.meta.final_permissions.can_edit_schema ||
      ctx.plugin.attributes.parameters.migratedFromLegacyPlugin
    ) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    await Promise.all(
      fields.map(async (field) => {
        if (field.attributes.appearance.editor === ctx.plugin.id) {
          await ctx.updateFieldAppearance(field.id, [
            {
              operation: "updateEditor",
              newFieldExtensionId: "typeform",
            },
          ]);
        }
      })
    );

    await ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      migratedFromLegacyPlugin: true,
    });

    ctx.notice("Plugin upgraded successfully!");
  },
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions() {
    return [
      {
        id: "typeform",
        name: "Typeform",
        type: "editor",
        fieldTypes: ["string"] as NonNullable<PluginAttributes["field_types"]>,
      },
    ];
  },
  renderFieldExtension(id, ctx) {
    render(
      <Provider store={store as any}>
        <FieldExtension ctx={ctx} />
      </Provider>
    );
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case "browseProducts":
        return render(
          <Provider store={store as any}>
            <BrowseProductsModal ctx={ctx} />
          </Provider>
        );
    }
  },
});
