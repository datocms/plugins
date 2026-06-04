import {useCallback, useEffect, useMemo, useRef} from 'react';
import type {CSSProperties, ChangeEvent} from 'react';
import {Canvas} from 'datocms-react-ui';
import type {RenderFieldExtensionCtx} from 'datocms-plugin-sdk';
import get from 'lodash-es/get';
import {normalizeFieldParameters, normalizePluginParameters} from '../lib/types';
import type {Option} from '../lib/types';
import s from '../lib/styles.module.css';

import lang, {EN_NO_VALUE_MATCH, EN_PLEASE_SELECT_OPTION, EN_NO_OPTIONS} from '../lang';
import Visualizer from '../components/visualizers/visualizer';

type VisualSelectProps = {
	ctx: RenderFieldExtensionCtx;
};

const defaults = {
	columns: 6,
	width: '250px',
};

const VisualSelect = ({ctx}: VisualSelectProps): JSX.Element => {
	const selectedField = useRef<HTMLInputElement>(null);

	const [options, presentation] = useMemo(() => {
		const {presets: allPresets} = normalizePluginParameters(ctx.plugin.attributes.parameters);
		const {config} = normalizeFieldParameters(ctx.parameters);
		const presetOptions = (config.presets ?? []).flatMap(key => allPresets[key] ?? []);
		return [[...presetOptions, ...(config.options ?? [])] as Option[], config.presentation ?? {}];
	}, [ctx.parameters, ctx.plugin.attributes.parameters]);

	const currentValue = useMemo(
		() => get(ctx.formValues, ctx.fieldPath) as string,
		[ctx.formValues, ctx.fieldPath],
	);

	const hasValidValue = useMemo(() => {
		return [...options, {value: null}].map(o => o.value).includes(currentValue);
	}, [options, currentValue]);

	const handleOnChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		ctx.setFieldValue(ctx.fieldPath, event.target.value);
	}, []);

	const customStyle: CSSProperties = useMemo(() => ({
		display: presentation.type === 'carousel' ? 'flex' : 'grid',
		gridTemplateColumns: `repeat(${presentation.columns ?? defaults.columns}, 1fr)`,
	}), [presentation]);

	const customWidth: CSSProperties = useMemo(() => (
		presentation.type === 'carousel' ? {width: presentation.width ?? defaults.width} : {}
	), [presentation]);

	useEffect(() => {
		if (presentation.type === 'carousel' && selectedField.current) {
			selectedField.current.scrollIntoView({block: 'nearest', inline: 'center'});
		}
	}, [selectedField]);

	return (
		<Canvas ctx={ctx}>
			{!hasValidValue && (
				<div className={s['notice']}>
					<div>{lang(EN_NO_VALUE_MATCH, {value: currentValue})}</div>
					<div><b>{lang(EN_PLEASE_SELECT_OPTION)}</b></div>
				</div>
			)}
			{options.length === 0 && (
				<div className={s['notice']}>{lang(EN_NO_OPTIONS)}</div>
			)}
			<div className={presentation.type === 'carousel' ? s['carousel-scroll-container'] : ''}>
				<fieldset style={customStyle} id={ctx.field.id} className={s['fieldset']}>
					{options.map(option => (
						<label key={option.name} className={s['label']} htmlFor={`${option.name}_${ctx.field.id}`}>
							<input
								id={`${option.name}_${ctx.field.id}`}
								className={s['radio']}
								type="radio"
								value={option.value}
								name="options"
								defaultChecked={currentValue == option.value}
								onChange={handleOnChange}
							/>
							<div
								ref={currentValue == option.value ? selectedField : null}
								style={customWidth}
								className={s['mark']}
							>
								<Visualizer option={option} />
								<span className={s['name']}>{option.name}</span>
							</div>
						</label>
					))}
				</fieldset>
			</div>
		</Canvas>
	);
};

export default VisualSelect;
