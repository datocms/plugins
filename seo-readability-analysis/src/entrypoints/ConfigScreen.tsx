import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, TextField, Form, FieldGroup } from 'datocms-react-ui';
import { Form as FormHandler, Field } from 'react-final-form';
import { Parameters } from '../types';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: PropTypes) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<Parameters>
        initialValues={ctx.plugin.attributes.parameters}
        validate={(values) => {
          const errors: Record<string, string> = {};
          if (!('htmlGeneratorUrl' in values) || !values.htmlGeneratorUrl) {
            errors.htmlGeneratorUrl = 'This field is required!';
          }
          return errors;
        }}
        onSubmit={async (values) => {
          await ctx.updatePluginParameters(values);
          ctx.notice('Settings updated successfully!');
        }}
      >
        {({ handleSubmit, submitting, dirty }) => (
          <Form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field name="htmlGeneratorUrl">
                {({ input, meta: { error } }) => (
                  <TextField
                    id="htmlGeneratorUrl"
                    label="Frontend metadata endpoint URL"
                    hint="A CORS-enabled endpoint that returns the required frontend metadata. It can include a query string. The itemId, itemTypeId, itemTypeApiKey, sandboxEnvironmentId and locale parameters will be added dynamically."
                    placeholder="https://yourwebsite.com/api/metadata?token=XXX"
                    required
                    error={error}
                    {...input}
                  />
                )}
              </Field>
              <Field name="autoApplyToFieldsWithApiKey">
                {({ input, meta: { error } }) => (
                  <TextField
                    id="autoApplyToFieldsWithApiKey"
                    label="Auto-apply to all JSON fields with the following API identifier:"
                    placeholder="seo_analysis"
                    error={error}
                    textInputProps={{ monospaced: true }}
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
