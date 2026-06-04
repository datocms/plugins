import {useState, useCallback} from 'react';
import {Button} from 'datocms-react-ui';
import s from '../../lib/styles.module.css';
import {FieldArray} from 'react-final-form-arrays';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faPlus} from '@fortawesome/free-solid-svg-icons';
import OptionCard from '../../components/OptionCard';

export default function OptionsSection(): JSX.Element {
	const [openOptions, setOpenOptions] = useState<Set<number>>(() => new Set());

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
		<FieldArray name="options">
			{({fields}) => (
				<>
					{fields.length === 0
						? <div className={s['empty-state']}>No custom options configured</div>
						: fields.map((name, index) => (
							<OptionCard
								key={name}
								fieldName={name}
								index={index}
								isOpen={openOptions.has(index)}
								onToggle={() => toggleOption(index)}
								onRemove={() => removeOption(fields.remove, index)}
							/>
						))
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
						Add custom option
					</Button>
				</>
			)}
		</FieldArray>
	);
}
