import {Button, FieldGroup, SelectField, TextField} from 'datocms-react-ui';
import {Field, useField, useFormState} from 'react-final-form';
import get from 'lodash-es/get';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faTrash} from '@fortawesome/free-solid-svg-icons';
import type {GroupBase} from 'react-select';
import CollapsibleCard from './CollapsibleCard';
import s from '../lib/styles.module.css';

type Opt = {label: string; value: string};

const TYPE_OPTIONS: Opt[] = [
	{value: 'color', label: 'Color'},
	{value: 'image', label: 'Image'},
];

const required = (value: unknown) =>
	typeof value === 'string' && value.trim() ? undefined : 'Required';

function OptionSwatch({type, source}: {type: string; source: string}): JSX.Element {
	if (type === 'color' && source) {
		return <span className={s['option-swatch']} style={{backgroundColor: source}} />;
	}
	if (type === 'image' && source) {
		return <img className={s['option-swatch-img']} src={source} alt="" loading="lazy" />;
	}
	return <span className={`${s['option-swatch']} ${s['option-swatch--empty']}`} />;
}

function OptionHeader({fieldName, index, onRemove}: {fieldName: string; index: number; onRemove: () => void}): JSX.Element {
	const {input: {value: name}} = useField(`${fieldName}.name`, {subscription: {value: true}});
	const {input: {value: type}} = useField(`${fieldName}.type`, {subscription: {value: true}});
	const {input: {value: color}} = useField(`${fieldName}.color`, {subscription: {value: true}});
	const {input: {value: url}} = useField(`${fieldName}.url`, {subscription: {value: true}});
	const source = type === 'image' ? url as string : color as string;

	return (
		<div className={s['option-title']}>
			<OptionSwatch type={type as string} source={source} />
			<span className={s['option-title-name']}>{(name as string) || `Option ${index + 1}`}</span>
			<Button
				type="button"
				buttonType="negative"
				buttonSize="xxs"
				leftIcon={<FontAwesomeIcon icon={faTrash} />}
				onClick={e => { e.stopPropagation(); onRemove(); }}
			/>
		</div>
	);
}

type OptionCardProps = {
	fieldName: string;
	index: number;
	isOpen: boolean;
	onToggle: () => void;
	onRemove: () => void;
};

export default function OptionCard({fieldName, index, isOpen, onToggle, onRemove}: OptionCardProps): JSX.Element {
	const {errors} = useFormState({subscription: {errors: true}});
	const hasError = !!get(errors, fieldName);

	return (
		<CollapsibleCard
			isOpen={isOpen}
			onToggle={onToggle}
			hasError={hasError && !isOpen}
			header={<OptionHeader fieldName={fieldName} index={index} onRemove={onRemove} />}
		>
			<FieldGroup>
				<div className={s['option-grid']}>
					<div>
						<Field name={`${fieldName}.name`} validate={required}>
							{({input, meta}) => (
								<TextField
									id={`${fieldName}.name`}
									name={`${fieldName}.name`}
									label="Name"
									value={input.value as string}
									onChange={input.onChange}
									error={meta.error as string | undefined}
								/>
							)}
						</Field>
					</div>
					<div>
						<Field name={`${fieldName}.value`} validate={required}>
							{({input, meta}) => (
								<TextField
									id={`${fieldName}.value`}
									name={`${fieldName}.value`}
									label="Value"
									value={input.value as string}
									onChange={input.onChange}
									error={meta.error as string | undefined}
									textInputProps={{monospaced: true}}
								/>
							)}
						</Field>
					</div>
					<div>
						<Field name={`${fieldName}.type`}>
							{({input}) => (
								<SelectField<Opt, false, GroupBase<Opt>>
									id={`${fieldName}.type`}
									name={`${fieldName}.type`}
									label="Type"
									value={TYPE_OPTIONS.find(o => o.value === input.value) ?? null}
									onChange={opt => input.onChange((opt as Opt).value)}
									selectInputProps={{options: TYPE_OPTIONS}}
								/>
							)}
						</Field>
					</div>
					<div>
						<Field name={`${fieldName}.type`} subscription={{value: true}}>
							{({input: {value: currentType}}) => {
								const isImage = currentType === 'image';
								const sourceName = isImage ? `${fieldName}.url` : `${fieldName}.color`;
								return (
									<Field name={sourceName} validate={required}>
										{({input, meta}) => (
											<TextField
												id={sourceName}
												name={sourceName}
												label={isImage ? 'Image URL' : 'Color'}
												placeholder={isImage ? 'https://example.com/icon.svg' : '#bada55'}
												value={input.value as string}
												onChange={input.onChange}
												error={meta.error as string | undefined}
											/>
										)}
									</Field>
								);
							}}
						</Field>
					</div>
				</div>
			</FieldGroup>
		</CollapsibleCard>
	);
}
