import {useCallback, useState} from 'react';
import type {ChangeEvent} from 'react';
import CodeEditor from '@uiw/react-textarea-code-editor';
import {FieldWrapper} from 'datocms-react-ui';
import type {Result} from '../lib/types';
import s from '../lib/styles.module.css';
import config from '../config';
import lang, {EN_JSON_PARSE_ERROR} from '../lang';

type JsonTextareaProps = {
	id: string;
	label: string;
	initialValue: string;
	onValidChange: (value: string) => void;
	onError?: (result: Result) => void;
	validate: (value: unknown) => Result;
};

const hint = (
	<a href={config.endpoints.docs} target="_blank" rel="noreferrer">
		View Documentation
	</a>
);

const JsonTextarea = ({id, label, initialValue, onValidChange, onError, validate}: JsonTextareaProps): JSX.Element => {
	const [value, setValue] = useState(initialValue);
	const [error, setError] = useState<string | undefined>();

	const handleOnChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
		const newValue = event.currentTarget.value;
		setValue(newValue);

		try {
			const json = JSON.parse(newValue) as unknown;
			const result = validate(json);

			if (result.type === 'success') {
				setError(undefined);
				onValidChange(newValue);
			} else {
				setError(result.message);
				onError?.({type: 'error', message: result.message});
			}
		} catch {
			const message = lang(EN_JSON_PARSE_ERROR);
			setError(message);
			onError?.({type: 'error', message});
		}
	}, [validate, onValidChange, onError]);

	return (
		<FieldWrapper id={id} label={label} hint={hint} error={error}>
			<div className={s['code-editor-wrapper']}>
				<CodeEditor
					value={value}
					language="json"
					padding={16}
					className={s['code-editor']}
					id={id}
					onChange={handleOnChange}
				/>
			</div>
		</FieldWrapper>
	);
};

export default JsonTextarea;
