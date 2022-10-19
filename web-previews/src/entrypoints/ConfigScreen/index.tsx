import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  TextField,
  Form,
  FieldGroup,
  SwitchField,
  Section,
} from 'datocms-react-ui';
import { Form as FormHandler, Field } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import { FieldArray } from 'react-final-form-arrays';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { Parameters } from '../../types';
import s from './styles.module.css';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

function isValidUrl(string: string) {
  let url;
  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

export default function ConfigScreen({ ctx }: PropTypes) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<Parameters>
        initialValues={ctx.plugin.attributes.parameters}
        validate={(values) => {
          const errors: Record<string, any> = {};

          errors.frontends =
            values.frontends &&
            values.frontends.map((rule) => {
              const ruleErrors: Record<string, string> = {};

              if (!rule.name) {
                ruleErrors.name = 'Name required!';
              }

              if (
                values.frontends.filter((f) => f.name === rule.name).length > 1
              ) {
                ruleErrors.name = 'Name must be unique!';
              }

              if (!rule.previewWebhook || !isValidUrl(rule.previewWebhook)) {
                ruleErrors.previewWebhook = 'Please specify an URL!';
              }

              return ruleErrors;
            });

          return errors;
        }}
        onSubmit={async (values) => {
          await ctx.updatePluginParameters(values);
          ctx.notice('Settings updated successfully!');
        }}
        mutators={{ ...arrayMutators }}
      >
        {({ handleSubmit, submitting, dirty }) => (
          <Form onSubmit={handleSubmit}>
            <Section
              title="Frontends"
              headerStyle={{ marginBottom: 'var(--spacing-m)' }}
            >
              <p>
                Please configure the different frontends that will return
                preview links:
              </p>
              <FieldArray name="frontends">
                {({ fields }) => (
                  <FieldGroup>
                    {fields.map((name, index) => (
                      <FieldGroup key={name}>
                        <div className={s.grid}>
                          <div>
                            <Field name={`${name}.name`}>
                              {({ input, meta: { error } }) => (
                                <TextField
                                  id="name"
                                  label="Frontend name"
                                  placeholder="Staging"
                                  required
                                  error={error}
                                  {...input}
                                />
                              )}
                            </Field>
                          </div>
                          <div>
                            <Field name={`${name}.previewWebhook`}>
                              {({ input, meta: { error } }) => (
                                <TextField
                                  id="previewWebhook"
                                  required
                                  label="Previews webhook URL"
                                  placeholder="https://yourwebsite.com/api/preview-links"
                                  error={error}
                                  {...input}
                                />
                              )}
                            </Field>
                          </div>
                          <Button
                            type="button"
                            buttonType="negative"
                            buttonSize="xxs"
                            leftIcon={<FontAwesomeIcon icon={faTrash} />}
                            onClick={() => fields.remove(index)}
                          />
                        </div>
                      </FieldGroup>
                    ))}
                    <Button
                      type="button"
                      buttonSize="xxs"
                      leftIcon={<FontAwesomeIcon icon={faPlus} />}
                      onClick={() => fields.push({ url: '', name: '' })}
                    >
                      Add new frontend
                    </Button>
                  </FieldGroup>
                )}
              </FieldArray>
            </Section>
            <Section title="Optional settings">
              <FieldGroup>
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
            </Section>
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
