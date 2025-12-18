import { connect } from "datocms-plugin-sdk";
import type { RenderPageCtx, SettingsAreaSidebarItemGroupsCtx } from "datocms-plugin-sdk";
import "datocms-react-ui/styles.css";
import ConfigScreen from "./entrypoints/ConfigScreen";
import OptimizeAssetsPage from "./entrypoints/OptimizeAssetsPage";
import { render } from "./utils/render";

connect({
	renderConfigScreen(ctx) {
		return render(<ConfigScreen ctx={ctx} />);
	},
	settingsAreaSidebarItemGroups(ctx: SettingsAreaSidebarItemGroupsCtx) {
		// Only show to users who can edit schema
		if (!ctx.currentRole.attributes.can_edit_schema) {
			return [];
		}

		return [
			{
				label: "Asset Management",
				items: [
					{
						label: "Optimize assets",
						icon: "images",
						pointsTo: {
							pageId: "optimize-assets",
						},
					},
				],
			},
		];
	},
	renderPage(pageId: string, ctx: RenderPageCtx) {
		switch (pageId) {
			case "optimize-assets":
				return render(<OptimizeAssetsPage ctx={ctx} />);
		}
	},
});
