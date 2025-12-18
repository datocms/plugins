/**
 * Main entry point for the DatoCMS Locale Duplicate plugin.
 * 
 * This plugin provides two main features:
 * 1. Mass locale duplication - bulk copy content between locales
 * 2. Field-level copying - copy individual field values between locales
 */
import { connect,  Field, OverrideFieldExtensionsCtx } from "datocms-plugin-sdk";
import "datocms-react-ui/styles.css";
import ConfigScreen from "./entrypoints/ConfigScreen";
import SettingsAreaSidebar from "./entrypoints/SettingsAreaSidebar";
import FieldExtension from "./entrypoints/FieldExtension";
import { render } from "./utils/render";
import { isFieldCopyConfigArray } from "./types";

/**
 * Initialize the DatoCMS plugin with its configuration
 */
connect({
	/**
	 * Renders the configuration screen where users select which fields
	 * should display copy buttons in the record editing interface
	 */
	renderConfigScreen(ctx) {
		return render(<ConfigScreen ctx={ctx} />);
	},
	/**
	 * Defines the sidebar menu item in the DatoCMS settings area
	 * for accessing the mass locale duplication feature
	 */
	settingsAreaSidebarItemGroups() {
		return [
			{
				label: 'Locale Duplicate',
				items: [
					{
						label: 'Mass Locale Duplication',
						icon: 'copy',
						pointsTo: {
							pageId: 'massLocaleDuplication',
						},
					},
				],
			},
		];
	},
	/**
	 * Renders the mass locale duplication page when accessed
	 * from the settings sidebar
	 */
	renderPage(pageId, ctx) {
		switch (pageId) {
			case 'massLocaleDuplication':
				return render(<SettingsAreaSidebar ctx={ctx} />);
		}
	},
	/**
	 * Determines which fields should display the locale copy button
	 * based on the plugin's configuration settings
	 */
	overrideFieldExtensions(field: Field, ctx: OverrideFieldExtensionsCtx) {
		// Retrieve field configurations from plugin parameters with type safety
		const paramConfigs = ctx.plugin.attributes.parameters?.fieldConfigs;
		const configs = isFieldCopyConfigArray(paramConfigs) ? paramConfigs : undefined;
		
		// Exit early if no configurations exist
		if (!configs || !Array.isArray(configs)) {
			return;
		}
		
		// Check if the current field is configured to show copy button
		const isConfigured = configs.some(
			config => config.modelId === ctx.itemType.id && config.fieldId === field.id
		);
		
		// Add the copy button addon to configured fields
		if (isConfigured) {
			return {
				addons: [{ id: 'localeCopyButton' }],
			};
		}
	},
	/**
	 * Renders the locale copy button UI for configured fields
	 * in the record editing interface
	 */
	renderFieldExtension(fieldExtensionId, ctx) {
		if (fieldExtensionId === 'localeCopyButton') {
			return render(<FieldExtension ctx={ctx} />);
		}
	},
});
