import {
  connect,
  OnBootCtx,
  RenderFieldExtensionCtx,
} from "datocms-plugin-sdk";
import { render } from "./utils/render";
import "datocms-react-ui/styles.css";
import NotesSidebar from "./entrypoints/NotesSidebar";
import TimeAgo from "javascript-time-ago";
import en from "javascript-time-ago/locale/en.json";

TimeAgo.addDefaultLocale(en);

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
        await ctx.updateFieldAppearance(field.id, [
          {
            operation: "updateEditor",
            newFieldExtensionId: "sidebarNotes",
          },
        ]);
      })
    );

    ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      migratedFromLegacyPlugin: true,
    });
  },

  manualFieldExtensions() {
    return [
      {
        id: "sidebarNotes",
        name: "Sidebar Notes",
        type: "editor",
        fieldTypes: ["json"],
        asSidebarPanel: true,
      },
    ];
  },
  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    if (fieldExtensionId === "sidebarNotes") {
      return render(<NotesSidebar ctx={ctx} />);
    }
  },
});
