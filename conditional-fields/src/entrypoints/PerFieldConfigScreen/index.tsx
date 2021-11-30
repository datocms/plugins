import { RenderManualFieldExtensionConfigScreenCtx } from "datocms-plugin-sdk";
import { Canvas, Form, TextField, SwitchField } from "datocms-react-ui";
import { useCallback, useState } from "react";
import { ManualExtensionParameters } from "../../types";

type PropTypes = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

export function PerFieldConfigScreen({ ctx }: PropTypes) {
  const [formValues, setFormValues] = useState<
    Partial<ManualExtensionParameters>
  >(ctx.parameters);

  const update = useCallback(
    (field, value) => {
      const newParameters = { ...formValues, [field]: value };
      setFormValues(newParameters);
      ctx.setParameters(newParameters);
    },
    [formValues, setFormValues, ctx]
  );

  return (
    <Canvas ctx={ctx}>
      <Form>
        <TextField
          id="followerFields"
          name="slaveFields"
          label="Fields that will be toggled based upon this field's value*"
          hint="Please insert the follower fields API key separated by commas"
          required
          value={formValues.slaveFields}
          onChange={update.bind(null, "slaveFields")}
        />
        <SwitchField
          id="invert"
          name="invert"
          label="Show follower fields when this field is false"
          value={formValues.invert}
          onChange={update.bind(null, "invert")}
        />
      </Form>
    </Canvas>
  );
}
