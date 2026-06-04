import {useCallback, useState} from 'react';
import {Canvas, Button, FieldGroup, Form, Section} from 'datocms-react-ui';
import type {RenderConfigScreenCtx} from 'datocms-plugin-sdk';
import {Form as FormHandler, useFormState} from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import {FieldArray} from 'react-final-form-arrays';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faPlus} from '@fortawesome/free-solid-svg-icons';
import type {Option, Preset, Presets} from '../../lib/types';
import {normalizePluginParameters} from '../../lib/types';
import s from '../../lib/styles.module.css';
import lang, {EN_SAVE_SETTINGS, EN_SETTINGS_UPDATED} from '../../lang';
import PresetSection from './PresetSection';

type Props = {ctx: RenderConfigScreenCtx};
type PresetEntry = {name: string; options: Option[]};
type FormValues = {presets: PresetEntry[]};

function presetsToFormValues(presets: Presets): FormValues {
	return {
		presets: Object.entries(presets).map(([name, options]) => ({name, options})),
	};
}

function cleanOption(raw: Record<string, string>): Option {
	if (raw.type === 'image') {
		return {name: raw.name ?? '', type: 'image', url: raw.url ?? '', value: raw.value ?? ''};
	}
	return {name: raw.name ?? '', type: 'color', color: raw.color ?? '', value: raw.value ?? ''};
}

function formValuesToPresets(values: FormValues): Presets {
	return Object.fromEntries(
		(values.presets ?? [])
			.filter(p => p?.name)
			.map(p => [
				p.name,
				(p.options ?? []).map(opt => cleanOption(opt as Record<string, string>)) as Preset,
			]),
	);
}

function SubmitButton(): JSX.Element {
	const {submitting, dirty, hasValidationErrors} = useFormState({subscription: {submitting: true, dirty: true, hasValidationErrors: true}});
	return (
		<Button
			type="submit"
			fullWidth
			buttonSize="l"
			buttonType="primary"
			disabled={submitting || !dirty || hasValidationErrors}
			className={s['space-top']}
		>
			{lang(EN_SAVE_SETTINGS)}
		</Button>
	);
}

export default function GlobalConfigScreen({ctx}: Props): JSX.Element {
	const [initialValues] = useState(() => presetsToFormValues(
		normalizePluginParameters(ctx.plugin.attributes.parameters).presets,
	));
	const [openPresets, setOpenPresets] = useState<Set<number>>(() => new Set());

	const togglePreset = useCallback((index: number) => {
		setOpenPresets(prev => {
			const next = new Set(prev);
			if (next.has(index)) next.delete(index); else next.add(index);
			return next;
		});
	}, []);

	const removePreset = useCallback((fields: {remove: (i: number) => void}, index: number) => {
		fields.remove(index);
		setOpenPresets(prev => {
			const next = new Set<number>();
			for (const i of prev) {
				if (i < index) next.add(i);
				else if (i > index) next.add(i - 1);
			}
			return next;
		});
	}, []);

	return (
		<Canvas ctx={ctx}>
			<FormHandler<FormValues>
				initialValues={initialValues}
				mutators={{...arrayMutators}}
				onSubmit={async (values) => {
					await ctx.updatePluginParameters({paramsVersion: '2', presets: formValuesToPresets(values)});
					ctx.notice(lang(EN_SETTINGS_UPDATED));
				}}
			>
				{({handleSubmit}) => (
					<Form onSubmit={handleSubmit} className={s['presets-config-form']}>
						<p>
							Presets are named collections of options you can reuse across multiple fields.
							Once defined here, any field using this plugin can reference one or more presets — their options will be merged together and made available for selection.
						</p>
						<Section title="Presets">
							<FieldArray name="presets">
								{({fields: presetFields}) => (
									<FieldGroup>
										{presetFields.map((presetName, presetIndex) => (
											<PresetSection
												key={presetName}
												presetName={presetName}
												presetIndex={presetIndex}
												displayName={(presetFields.value[presetIndex] as PresetEntry | undefined)?.name ?? ''}
												isOpen={openPresets.has(presetIndex)}
												onToggle={() => togglePreset(presetIndex)}
												onRemove={() => removePreset(presetFields, presetIndex)}
											/>
										))}
										<Button
											type="button"
											buttonSize="s"
											leftIcon={<FontAwesomeIcon icon={faPlus} />}
											onClick={() => {
												const newIndex = presetFields.length ?? 0;
												presetFields.push({name: '', options: []});
												setOpenPresets(prev => new Set([...prev, newIndex]));
											}}
										>
											Add preset
										</Button>
									</FieldGroup>
								)}
							</FieldArray>
						</Section>
						<SubmitButton />
					</Form>
				)}
			</FormHandler>
		</Canvas>
	);
}
