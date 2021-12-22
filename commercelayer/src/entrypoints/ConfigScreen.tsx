import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, TextField, Form, FieldGroup } from 'datocms-react-ui';
import { Form as FormHandler, Field } from 'react-final-form';
import { ValidConfig, normalizeConfig } from '../types';
import CommerceLayerClient from '../utils/CommerceLayerClient';
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<ValidConfig>
        initialValues={normalizeConfig(ctx.plugin.attributes.parameters)}
        validate={(values: ValidConfig) => {
          const errors: Record<string, string> = {};

          if (!values.baseEndpoint) {
            errors.baseEndpoint = 'This field is required!';
          }

          if (!values.clientId) {
            errors.clientId = 'This field is required!';
          }

          return errors;
        }}
        onSubmit={async (values: ValidConfig) => {
          try {
            const client = new CommerceLayerClient(values);
            await client.getToken();
          } catch (e) {
            return {
              tupleFailing:
                'The API key seems to be invalid for the specified CommerceLayer project!',
            };
          }

          await ctx.updatePluginParameters(values);
          ctx.notice('Settings updated successfully!');
        }}
      >
        {({ handleSubmit, submitting, dirty, submitErrors }) => (
          <Form onSubmit={handleSubmit}>
            {submitErrors && submitErrors.tupleFailing && (
              <div className={s.error}>{submitErrors.tupleFailing}</div>
            )}
            <FieldGroup>
              <Field name="baseEndpoint">
                {({ input, meta: { error } }) => (
                  <TextField
                    id="baseEndpoint"
                    label="Commerce Layer Base endpoint"
                    placeholder="https://dato-commerce.commercelayer.io"
                    required
                    error={error}
                    textInputProps={{ monospaced: true }}
                    {...input}
                  />
                )}
              </Field>
              <Field name="clientId">
                {({ input, meta: { error } }) => (
                  <TextField
                    id="clientId"
                    label="OAuth Application Client ID"
                    hint="Go to https://[your-instance].commercelayer.io/admin/settings/applications to find your OAuth applications"
                    required
                    textInputProps={{ monospaced: true }}
                    placeholder="XXXYYY"
                    error={error}
                    {...input}
                  />
                )}
              </Field>
              <Field name="autoApplyToFieldsWithApiKey">
                {({ input, meta: { error } }) => (
                  <TextField
                    id="autoApplyToFieldsWithApiKey"
                    label="Auto-apply this plugin to all Single-line fields fields matching the following API identifier:"
                    hint="A regular expression can be used"
                    placeholder="shopify_product_id"
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
