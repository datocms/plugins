import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  Form,
  FormLabel,
  TextField,
} from 'datocms-react-ui';
import arrayMutators from 'final-form-arrays';
import { Field, Form as FormHandler } from 'react-final-form';
import { FieldArray } from 'react-final-form-arrays';
import type { CustomHeader, Parameters } from '../types';
import s from './styles.module.css';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

type ConfigErrors = {
  htmlGeneratorUrl?: string;
  customHeaders?: Record<string, string>[];
};

function validateCustomHeaders(
  headers: CustomHeader[] | undefined,
): Record<string, string>[] | undefined {
  return headers?.map((header) => {
    const headerErrors: Record<string, string> = {};

    if (!header.name) {
      headerErrors.name = 'Name required!';
    } else if (headers.filter((h) => h.name === header.name).length > 1) {
      headerErrors.name = 'Name must be unique!';
    }

    if (!header.value) {
      headerErrors.value = 'Value required!';
    }

    return headerErrors;
  });
}

export default function ConfigScreen({ ctx }: PropTypes) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<Parameters>
        initialValues={ctx.plugin.attributes.parameters}
        mutators={{ ...arrayMutators }}
        validate={(values) => {
          const errors: ConfigErrors = {};

          if (!('htmlGeneratorUrl' in values) || !values.htmlGeneratorUrl) {
            errors.htmlGeneratorUrl = 'This field is required!';
          }

          errors.customHeaders = validateCustomHeaders(
            'customHeaders' in values ? values.customHeaders : undefined,
          );

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
                    placeholder="https://yourwebsite.com/api/metadata"
                    required
                    error={error}
                    {...input}
                  />
                )}
              </Field>
              <div>
                <FormLabel htmlFor="">Custom headers</FormLabel>
                <FieldArray name="customHeaders">
                  {({ fields }) => (
                    <FieldGroup>
                      {fields.map((header, headerIndex) => (
                        <div key={header} className={s.deletableItem}>
                          <div className={s.headerGrid}>
                            <div>
                              <Field name={`${header}.name`}>
                                {({ input, meta: { error } }) => (
                                  <TextField
                                    id={`headers-${headerIndex}-name`}
                                    label="Header"
                                    placeholder="Header"
                                    required
                                    error={error}
                                    {...input}
                                  />
                                )}
                              </Field>
                            </div>
                            <div>
                              <Field name={`${header}.value`}>
                                {({ input, meta: { error } }) => (
                                  <TextField
                                    id={`headers-${headerIndex}-value`}
                                    label="Value"
                                    placeholder="Value"
                                    required
                                    error={error}
                                    {...input}
                                  />
                                )}
                              </Field>
                            </div>
                          </div>
                          <div className={s.deletableItemAction}>
                            <Button
                              type="button"
                              buttonType="negative"
                              buttonSize="s"
                              onClick={() => fields.remove(headerIndex)}
                            >
                              Remove header
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        buttonSize="s"
                        onClick={() => fields.push({ name: '', value: '' })}
                      >
                        Add header
                      </Button>
                    </FieldGroup>
                  )}
                </FieldArray>
              </div>
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
