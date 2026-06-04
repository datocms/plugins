import {useCallback, useState} from 'react';
import type {FormEvent} from 'react';
import {Canvas, FieldGroup, Button} from 'datocms-react-ui';
import type {RenderConfigScreenCtx} from 'datocms-plugin-sdk';
import {validatePresetsConfig} from '../lib/validators';
import {JsonTextarea} from '../components';
import type {PluginParameters, Result} from '../lib/types';
import s from '../lib/styles.module.css';
import {JSON_INDENT_SIZE} from '../constants';
import lang, {EN_SAVE_SETTINGS, EN_SETTINGS_UPDATED} from '../lang';

type GlobalConfigScreenProps = {
	ctx: RenderConfigScreenCtx;
};

type State = {
	parameters: PluginParameters;
	valid: boolean;
};

const INITIAL_PRESETS = JSON.stringify({}, null, JSON_INDENT_SIZE);

const formatParameters = (parameters: PluginParameters): PluginParameters => ({
	presets: JSON.stringify(JSON.parse(parameters.presets ?? INITIAL_PRESETS), null, JSON_INDENT_SIZE),
});

const GlobalConfigScreen = ({ctx}: GlobalConfigScreenProps): JSX.Element => {
	const [state, setState] = useState<State>({
		parameters: ctx.plugin.attributes.parameters as PluginParameters,
		valid: false,
	});

	const handleOnSubmit = useCallback(async (event: FormEvent) => {
		event.preventDefault();

		await ctx.updatePluginParameters(formatParameters(state.parameters));
		ctx.notice(lang(EN_SETTINGS_UPDATED));
	}, [state]);

	const handleOnChange = useCallback((value: string) => {
		setState({
			valid: true,
			parameters: {
				presets: value,
			},
		});
	}, []);

	const handleOnError = useCallback((_result: Result) => {
		setState(current => ({
			...current,
			valid: false,
		}));
	}, []);

	return (
		<Canvas ctx={ctx}>
			<form className={s['presets-config-form']} onSubmit={handleOnSubmit}>
				<FieldGroup>
					<JsonTextarea
						id="presets"
						label="Global Presets"
						initialValue={state.parameters.presets ?? INITIAL_PRESETS}
						validate={validatePresetsConfig}
						onValidChange={handleOnChange}
						onError={handleOnError}
					/>
				</FieldGroup>
				<Button
					fullWidth
					type="submit"
					buttonSize="l"
					buttonType="primary"
					disabled={!state.valid}
					className={s['space-top']}
				>
					{lang(EN_SAVE_SETTINGS)}
				</Button>
			</form>
		</Canvas>
	);
};

export default GlobalConfigScreen;
