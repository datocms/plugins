import {useState, useCallback} from 'react';
import {Button, FieldGroup, FormLabel, TextField} from 'datocms-react-ui';
import {Field, useFormState} from 'react-final-form';
import {FieldArray} from 'react-final-form-arrays';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faPlus, faTrash} from '@fortawesome/free-solid-svg-icons';
import get from 'lodash-es/get';
import CollapsibleCard from '../../components/CollapsibleCard';
import OptionCard from '../../components/OptionCard';
import s from '../../lib/styles.module.css';

const required = (value: unknown) =>
	typeof value === 'string' && value.trim() ? undefined : 'Required';

type PresetSectionProps = {
	presetName: string;
	presetIndex: number;
	displayName: string;
	isOpen: boolean;
	onToggle: () => void;
	onRemove: () => void;
};

export default function PresetSection({presetName, presetIndex, displayName, isOpen, onToggle, onRemove}: PresetSectionProps): JSX.Element {
	const [openOptions, setOpenOptions] = useState<Set<number>>(() => new Set());
	const {errors} = useFormState({subscription: {errors: true}});
	const hasError = !!get(errors, presetName);

	const toggleOption = useCallback((index: number) => {
		setOpenOptions(prev => {
			const next = new Set(prev);
			if (next.has(index)) next.delete(index); else next.add(index);
			return next;
		});
	}, []);

	const removeOption = useCallback((remove: (i: number) => void, index: number) => {
		remove(index);
		setOpenOptions(prev => {
			const next = new Set<number>();
			for (const i of prev) {
				if (i < index) next.add(i);
				else if (i > index) next.add(i - 1);
			}
			return next;
		});
	}, []);

	return (
		<CollapsibleCard
			isOpen={isOpen}
			onToggle={onToggle}
			hasError={hasError && !isOpen}
			header={
				<div className={s['preset-header']}>
					<span className={s['preset-title']}>{displayName || `Preset ${presetIndex + 1}`}</span>
					<Button
						type="button"
						buttonType="negative"
						buttonSize="xxs"
						leftIcon={<FontAwesomeIcon icon={faTrash} />}
						onClick={e => { e.stopPropagation(); onRemove(); }}
					/>
				</div>
			}
		>
			<FieldGroup>
				<Field name={`${presetName}.name`} validate={required}>
					{({input, meta}) => (
						<TextField
							id={`${presetName}.name`}
							name={`${presetName}.name`}
							label="Name"
							placeholder="e.g. Brand Colors"
							value={input.value as string}
							onChange={input.onChange}
							error={meta.error as string | undefined}
						/>
					)}
				</Field>

				<div>
					<FormLabel htmlFor="">Options</FormLabel>
					<FieldArray name={`${presetName}.options`}>
						{({fields}) => (
							<>
								{fields.length === 0
									? <div className={s['empty-state']}>No options configured</div>
									: <div className={s['nested-options']}>
										{fields.map((optName, optIndex) => (
											<OptionCard
												key={optName}
												fieldName={optName}
												index={optIndex}
												isOpen={openOptions.has(optIndex)}
												onToggle={() => toggleOption(optIndex)}
												onRemove={() => removeOption(fields.remove, optIndex)}
											/>
										))}
									</div>
								}
								<Button
									type="button"
									buttonSize="xxs"
									leftIcon={<FontAwesomeIcon icon={faPlus} />}
									onClick={() => {
										const newIndex = fields.length ?? 0;
										fields.push({name: '', type: 'color', color: '', value: ''});
										setOpenOptions(prev => new Set([...prev, newIndex]));
									}}
								>
									Add option
								</Button>
							</>
						)}
					</FieldArray>
				</div>
			</FieldGroup>
		</CollapsibleCard>
	);
}
