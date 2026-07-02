import {useCallback, useRef, useState} from 'react';
import type {RenderManualFieldExtensionConfigScreenCtx} from 'datocms-plugin-sdk';
import {Canvas, FieldGroup, Form, SelectField, Section} from 'datocms-react-ui';
import {Form as FormHandler, FormSpy, Field} from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import type {GroupBase} from 'react-select';
import type {FieldConfig, Presentation, ValidFieldParameters, ValidPluginParameters} from '../../lib/types';
import {normalizeFieldParameters, normalizeOption, normalizePluginParameters} from '../../lib/types';
import OptionsSection from './OptionsSection';
import PresentationSection from './PresentationSection';

type Props = {ctx: RenderManualFieldExtensionConfigScreenCtx};
type Opt = {label: string; value: string};

type FormValues = FieldConfig;

function cleanFieldConfig(values: Partial<FormValues>): ValidFieldParameters {
	const config: FieldConfig = {};
	if (values.presets?.length) config.presets = values.presets;
	if (values.options?.length) {
		config.options = values.options.map(opt => normalizeOption(opt as Record<string, string>));
	}
	if (values.presentation) {
		const pres: Presentation = {};
		if (values.presentation.type) pres.type = values.presentation.type;
		if (values.presentation.columns != null) pres.columns = Number(values.presentation.columns);
		if (values.presentation.width) pres.width = values.presentation.width;
		if (Object.keys(pres).length > 0) config.presentation = pres;
	}
	return {paramsVersion: '2', config};
}

export default function FieldConfigScreen({ctx}: Props): JSX.Element {
	const [initialValues] = useState<FormValues>(() => normalizeFieldParameters(ctx.parameters).config);
	const hasMounted = useRef(false);

	const [presetOptions] = useState<Opt[]>(() => {
		const pluginParams = normalizePluginParameters(ctx.plugin.attributes.parameters) as ValidPluginParameters;
		return Object.keys(pluginParams.presets).map(k => ({value: k, label: k}));
	});

	const handleFormSpy = useCallback(({values}: {values: FormValues}) => {
		if (!hasMounted.current) { hasMounted.current = true; return; }
		ctx.setParameters(cleanFieldConfig(values));
	}, [ctx]);

	return (
		<Canvas ctx={ctx}>
			<FormHandler<FormValues>
				initialValues={initialValues}
				mutators={{...arrayMutators}}
				onSubmit={() => {}}
			>
				{({handleSubmit}) => (
					<Form onSubmit={handleSubmit}>
						<Section title="Options">
							<FieldGroup>
								{presetOptions.length > 0 && (
									<Field name="presets">
										{({input}) => (
											<SelectField<Opt, true, GroupBase<Opt>>
												id="presets"
												name="presets"
												label="From presets"
												hint="Merge options from one or more global presets"
												value={presetOptions.filter(o => (input.value as string[] ?? []).includes(o.value))}
												onChange={opts => input.onChange((opts as Opt[]).map(o => o.value))}
												selectInputProps={{isMulti: true, options: presetOptions, isClearable: true}}
											/>
										)}
									</Field>
								)}
								<OptionsSection />
							</FieldGroup>
						</Section>
						<PresentationSection />
						<FormSpy subscription={{values: true}} onChange={handleFormSpy} />
					</Form>
				)}
			</FormHandler>
		</Canvas>
	);
}
