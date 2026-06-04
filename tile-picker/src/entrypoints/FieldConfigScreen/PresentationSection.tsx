import {FieldGroup, Section, SelectField, TextField} from 'datocms-react-ui';
import {Field} from 'react-final-form';
import type {GroupBase} from 'react-select';

type Opt = {label: string; value: string};

const LAYOUT_OPTIONS: Opt[] = [
	{value: 'grid', label: 'Grid'},
	{value: 'carousel', label: 'Carousel'},
];

export default function PresentationSection(): JSX.Element {
	return (
		<Section title="Presentation">
			<Field name="presentation.type" subscription={{value: true}}>
				{({input: {value: layoutType}}) => (
					<FieldGroup>
						<Field name="presentation.type">
							{({input}) => (
								<SelectField<Opt, false, GroupBase<Opt>>
									id="presentation.type"
									name="presentation.type"
									label="Layout"
									hint="Defaults to grid"
									value={LAYOUT_OPTIONS.find(o => o.value === input.value) ?? null}
									onChange={opt => input.onChange((opt as Opt | null)?.value ?? undefined)}
									selectInputProps={{options: LAYOUT_OPTIONS, isClearable: true}}
								/>
							)}
						</Field>
						{(!layoutType || layoutType === 'grid') && (
							<Field name="presentation.columns">
								{({input}) => (
									<TextField
										id="presentation.columns"
										name="presentation.columns"
										label="Columns"
										placeholder="6"
										value={input.value as string}
										onChange={input.onChange}
										textInputProps={{type: 'number'}}
									/>
								)}
							</Field>
						)}
						{layoutType === 'carousel' && (
							<Field name="presentation.width">
								{({input}) => (
									<TextField
										id="presentation.width"
										name="presentation.width"
										label="Card width"
										placeholder="250px"
										value={input.value as string}
										onChange={input.onChange}
									/>
								)}
							</Field>
						)}
					</FieldGroup>
				)}
			</Field>
		</Section>
	);
}
