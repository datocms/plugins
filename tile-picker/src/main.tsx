import {connect} from 'datocms-plugin-sdk';
import type {
	ManualFieldExtensionsCtx,
	RenderManualFieldExtensionConfigScreenCtx,
	RenderFieldExtensionCtx,
	RenderConfigScreenCtx,
	FieldAppearanceChange,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import {render} from './utils/render';
import FieldConfigScreen from './entrypoints/FieldConfigScreen';
import VisualSelect from './entrypoints/VisualSelect';
import GlobalConfigScreen from './entrypoints/GlobalConfigScreen';
import {validateFieldConfig} from './lib/validators';
import {
	isValidPluginParameters, normalizePluginParameters,
	isValidFieldParameters, normalizeFieldParameters,
} from './lib/types';

connect({
	async onBoot(ctx) {
		if (!ctx.currentRole.meta.final_permissions.can_edit_schema) return;

		if (!isValidPluginParameters(ctx.plugin.attributes.parameters)) {
			await ctx.updatePluginParameters(
				normalizePluginParameters(ctx.plugin.attributes.parameters),
			);
		}

		const fields = await ctx.loadFieldsUsingPlugin();
		const someUpgraded = (await Promise.all(fields.map(async (field) => {
			if (isValidFieldParameters(field.attributes.appearance.parameters)) return false;
			const changes: FieldAppearanceChange[] = [{
				operation: 'updateEditor',
				newFieldExtensionId: 'visualSelect',
				newParameters: normalizeFieldParameters(field.attributes.appearance.parameters),
			}];
			await ctx.updateFieldAppearance(field.id, changes);
			return true;
		}))).some(Boolean);

		if (someUpgraded) ctx.notice('Tile Picker settings upgraded!');
	},

	renderConfigScreen(ctx: RenderConfigScreenCtx) {
		render(<GlobalConfigScreen ctx={ctx} />);
	},

	manualFieldExtensions(_ctx: ManualFieldExtensionsCtx) {
		return [
			{
				id: 'visualSelect',
				name: 'Tile Picker',
				type: 'editor',
				fieldTypes: ['text', 'string'],
				configurable: true,
			},
		];
	},

	validateManualFieldExtensionParameters(
		_fieldExtensionId: string,
		parameters: Record<string, unknown>,
	) {
		const errors: Record<string, string> = {};
		const normalized = normalizeFieldParameters(parameters);
		const result = validateFieldConfig(normalized.config);
		if (result.type === 'error') {
			errors.config = result.message;
		}
		return errors;
	},

	renderFieldExtension(_fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
		render(<VisualSelect ctx={ctx} />);
	},

	renderManualFieldExtensionConfigScreen(
		_fieldExtensionId: string,
		ctx: RenderManualFieldExtensionConfigScreenCtx,
	) {
		render(<FieldConfigScreen ctx={ctx} />);
	},
});
