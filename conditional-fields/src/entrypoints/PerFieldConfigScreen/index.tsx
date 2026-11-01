import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import { useState } from 'react';
import {
  type BooleanTriggerParameters,
  isValidParameters,
  type ScalarTriggerParameters,
  type ValidManualExtensionParameters,
} from '../../types';
import { isDefined } from '../../utils/isDefined';
import normalizeParams from '../../utils/normalizeParams';

type PropTypes = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

const CONDITIONS = [
  { value: 'checked', label: 'Checked' },
  { value: 'unchecked', label: 'Unchecked' },
] as const;

function defaultParams(
  isBooleanField: boolean,
): ValidManualExtensionParameters {
  return isBooleanField
    ? { targetFieldsApiKey: [], invert: false }
    : { targetFieldsApiKey: [], showWhenValues: [] };
}

export function PerFieldConfigScreen({ ctx }: PropTypes) {
  const isBooleanField = ctx.pendingField.attributes.field_type === 'boolean';

  const [formValues, setFormValues] = useState<
    Partial<ValidManualExtensionParameters>
  >(
    isValidParameters(ctx.parameters)
      ? ctx.parameters
      : isBooleanField
        ? normalizeParams(ctx.parameters)
        : defaultParams(false),
  );

  function update(field: string, value: unknown) {
    const newParameters = { ...formValues, [field]: value };
    setFormValues(newParameters);
    ctx.setParameters(newParameters);
  }

  const fieldOptions = Object.values(ctx.fields)
    .filter(isDefined)
    .filter(
      (field) =>
        field.relationships.item_type.data.id === ctx.itemType.id &&
        field.id !== ctx.pendingField.id,
    )
    .map((field) => ({
      label: field.attributes.label,
      value: field.attributes.api_key,
    }));

  const showWhenValues =
    (formValues as Partial<ScalarTriggerParameters>).showWhenValues ?? [];

  return (
    <Canvas ctx={ctx}>
      {isBooleanField ? (
        <FieldWrapper label="When this field is">
          <RadioGroupInput
            options={CONDITIONS}
            value={
              (formValues as Partial<BooleanTriggerParameters>).invert
                ? 'unchecked'
                : 'checked'
            }
            onChange={(value) => update('invert', value === 'unchecked')}
          />
        </FieldWrapper>
      ) : (
        <FieldWrapper
          label="When this field's value is one of"
          hint="Type a value and press Enter to add it."
        >
          <SelectInput
            multiple
            clearable
            options={showWhenValues.map((value) => ({ value, label: value }))}
            value={showWhenValues}
            onChange={(values) => update('showWhenValues', values ?? [])}
            creatable={{
              onCreate: (value) =>
                update('showWhenValues', [...showWhenValues, value]),
            }}
          />
        </FieldWrapper>
      )}
      <FieldWrapper
        label="Show these fields"
        required
        hint="They're hidden when the condition isn't met."
      >
        <SelectInput
          multiple
          clearable
          placeholder="Pick fields"
          options={fieldOptions}
          // Saved fields that are no longer in the model don't show
          value={(formValues.targetFieldsApiKey ?? []).filter((apiKey) =>
            fieldOptions.some((option) => option.value === apiKey),
          )}
          onChange={(apiKeys) => update('targetFieldsApiKey', apiKeys ?? [])}
        />
      </FieldWrapper>
    </Canvas>
  );
}
