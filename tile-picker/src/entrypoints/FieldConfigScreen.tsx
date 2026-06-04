import {useCallback, useEffect, useState} from 'react';
import {isString} from 'remeda';
import type {RenderManualFieldExtensionConfigScreenCtx} from 'datocms-plugin-sdk';
import {Canvas, Form} from 'datocms-react-ui';
import {validateFieldConfig} from '../lib/validators';
import {JsonTextarea} from '../components';
import type {FieldParameters} from '../lib/types';
import {EMPTY_LENGTH, JSON_INDENT_SIZE} from '../constants';
import lang, {EN_FIELD_CONFIGURATION} from '../lang';

type Props = {
	ctx: RenderManualFieldExtensionConfigScreenCtx;
};

const INITIAL_COLLECTION = JSON.stringify({extends: [], options: []}, null, JSON_INDENT_SIZE);

function FieldConfigScreen({ctx}: Props): JSX.Element {
	const {collection: existing} = ctx.parameters as FieldParameters;
	const initialValue = isString(existing) && existing.length > EMPTY_LENGTH
		? existing
		: INITIAL_COLLECTION;

	const [collection, setCollection] = useState(initialValue);

	useEffect(() => {
		if (!isString(existing) || existing.length === EMPTY_LENGTH) {
			ctx.setParameters({collection: INITIAL_COLLECTION});
		}
	}, []);

	const handleChange = useCallback((value: string) => {
		setCollection(value);
		ctx.setParameters({collection: JSON.stringify(JSON.parse(value), null, JSON_INDENT_SIZE)});
	}, []);

	return (
		<Canvas ctx={ctx}>
			<Form>
				<JsonTextarea
					id="collection"
					label={lang(EN_FIELD_CONFIGURATION)}
					initialValue={collection}
					validate={validateFieldConfig}
					onValidChange={handleChange}
				/>
			</Form>
		</Canvas>
	);
}

export default FieldConfigScreen;
