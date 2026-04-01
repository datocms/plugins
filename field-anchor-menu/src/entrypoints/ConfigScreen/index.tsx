import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  Form,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
import { Field, Form as FormHandler } from 'react-final-form';
import {
  normalizeGlobalParams,
  type ValidGlobalParams,
} from '../../utils/globalParams';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<ValidGlobalParams>
        initialValues={normalizeGlobalParams(ctx.plugin.attributes.parameters)}
        onSubmit={async (values: ValidGlobalParams) => {
          await ctx.updatePluginParameters(values);
          ctx.notice('Settings updated successfully!');
        }}
      >
        {({ handleSubmit, submitting, dirty }) => (
          <Form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field name="minFieldsToShow">
                {({ input, meta: { error } }) => (
                  <TextField
                    id="minFieldsToShow"
                    label="Show the sidebar panel for all models with at least this number of fields:"
                    required
                    error={error}
                    {...input}
                  />
                )}
              </Field>
              <Field name="startOpen">
                {({ input, meta: { error } }) => (
                  <SwitchField
                    id="startOpen"
                    label="Start the sidebar panel open?"
                    error={error}
                    {...input}
                  />
                )}
              </Field>
            </FieldGroup>
            <Button
              type="submit"
              fullWidth
              buttonSize="l"
              buttonType="primary"
              disabled={submitting || !dirty}
            >
              Save settings
            </Button>
          </Form>
        )}
      </FormHandler>
    </Canvas>
  );
}
