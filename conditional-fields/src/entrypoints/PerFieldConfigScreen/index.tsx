import { RenderManualFieldExtensionConfigScreenCtx } from "datocms-plugin-sdk";
import { Canvas, Form, SwitchField, SelectField } from "datocms-react-ui";
import { useCallback, useState } from "react";
import { isValidParameters, ValidManualExtensionParameters } from "../../types";
import normalizeParams from "../../utils/normalizeParams";
import { isDefined } from "../../utils/isDefined";

type PropTypes = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

export function PerFieldConfigScreen({ ctx }: PropTypes) {
  const [formValues, setFormValues] = useState<
    Partial<ValidManualExtensionParameters>
  >(
    isValidParameters(ctx.parameters)
      ? ctx.parameters
      : normalizeParams(ctx.parameters)
  );

  const update = useCallback(
    (field: string, value: unknown) => {
      const newParameters = { ...formValues, [field]: value };
      setFormValues(newParameters);
      ctx.setParameters(newParameters);
    },
    [formValues, setFormValues, ctx]
  );

  const options = Object.values(ctx.fields)
    .filter(isDefined)
    .filter(
      (field) =>
        field.relationships.item_type.data.id === ctx.itemType.id &&
        field.id !== ctx.pendingField.id
    )
    .map((field) => ({
      label: field.attributes.label,
      value: field.attributes.api_key,
    }));

  return (
    <Canvas ctx={ctx}>
      <Form>
        <SelectField
          id="targetFieldsApiKey"
          name="targetFieldsApiKey"
          label="Fields to be hidden/shown"
          required
          selectInputProps={{ isMulti: true, options }}
          value={formValues.targetFieldsApiKey ? formValues.targetFieldsApiKey.map((apiKey) =>
            options.find((o) => o.value === apiKey)
          ) : []}
          onChange={(selectedOptions) => {
            update(
              "targetFieldsApiKey",
              selectedOptions.filter(isDefined).map((o) => o.value)
            );
          }}
        />
        <SwitchField
          id="invert"
          name="invert"
          label="Invert visibility?"
          hint="When this field is checked, hide target fields"
          value={formValues.invert || false}
          onChange={update.bind(null, "invert")}
        />
      </Form>
    </Canvas>
  );
}
