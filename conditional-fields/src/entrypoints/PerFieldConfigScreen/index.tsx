import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, CreatableSelectField, Form, SelectField } from 'datocms-react-ui';
import { useCallback, useState } from 'react';
import {
  isValidParameters,
  type BooleanTriggerParameters,
  type ScalarTriggerParameters,
  type ValidManualExtensionParameters,
} from '../../types';
import { isDefined } from '../../utils/isDefined';
import normalizeParams from '../../utils/normalizeParams';

type PropTypes = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

function defaultParams(isBooleanField: boolean): ValidManualExtensionParameters {
  return isBooleanField
    ? { targetFieldsApiKey: [], invert: false }
    : { targetFieldsApiKey: [], showWhenValues: [] };
}

export function PerFieldConfigScreen({ ctx }: PropTypes) {
  const isBooleanField = ctx.pendingField.attributes.field_type === 'boolean';

  const [formValues, setFormValues] = useState<Partial<ValidManualExtensionParameters>>(
    isValidParameters(ctx.parameters)
      ? ctx.parameters
      : isBooleanField
        ? normalizeParams(ctx.parameters)
        : defaultParams(false),
  );

  const update = useCallback(
    (field: string, value: unknown) => {
      const newParameters = { ...formValues, [field]: value };
      setFormValues(newParameters);
      ctx.setParameters(newParameters);
    },
    [formValues, ctx],
  );

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

  return (
    <Canvas ctx={ctx}>
      <Form>
        {isBooleanField ? (
          <SelectField
            id="invert"
            name="invert"
            label="When this field is"
            selectInputProps={{
              options: [
                { label: 'checked', value: 'false' },
                { label: 'unchecked', value: 'true' },
              ],
            }}
            value={
              (formValues as Partial<BooleanTriggerParameters>).invert
                ? { label: 'unchecked', value: 'true' }
                : { label: 'checked', value: 'false' }
            }
            onChange={(option) => {
              const single = Array.isArray(option) ? option[0] : option;
              update('invert', single?.value === 'true');
            }}
          />
        ) : (
          <CreatableSelectField
            id="showWhenValues"
            name="showWhenValues"
            label="When the value of this field is one of"
            hint="Type a value and press Enter to add it"
            selectInputProps={{ isMulti: true }}
            value={
              ((formValues as Partial<ScalarTriggerParameters>).showWhenValues || []).map(
                (v) => ({ label: v, value: v }),
              )
            }
            onChange={(selected) => {
              update(
                'showWhenValues',
                selected ? selected.filter(isDefined).map((o) => o.value) : [],
              );
            }}
          />
        )}
        <SelectField
          id="targetFieldsApiKey"
          name="targetFieldsApiKey"
          label="Then show these fields"
          required
          selectInputProps={{ isMulti: true, options: fieldOptions }}
          value={
            formValues.targetFieldsApiKey
              ? formValues.targetFieldsApiKey.map((apiKey) =>
                  fieldOptions.find((o) => o.value === apiKey),
                )
              : []
          }
          onChange={(selectedOptions) => {
            update(
              'targetFieldsApiKey',
              selectedOptions.filter(isDefined).map((o) => o.value),
            );
          }}
        />
      </Form>
    </Canvas>
  );
}
