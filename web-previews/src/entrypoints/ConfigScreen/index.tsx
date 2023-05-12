import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  TextField,
  Form,
  FieldGroup,
  SwitchField,
  Section,
  FormLabel,
} from 'datocms-react-ui';
import { Form as FormHandler, Field } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import { FieldArray } from 'react-final-form-arrays';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { Frontend, Parameters } from '../../types';
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
        initialValues={{ sidebarWidth: 900, ...ctx.plugin.attributes.parameters, frontends: ctx.plugin.attributes.parameters.frontends as Frontend[] || [] }}
        validate={(values) => {
          const errors: Record<string, any> = {};

          errors.frontends =
            values.frontends?.map((rule) => {
              const ruleErrors: Record<string, any> = {};

              if (!rule.name) {
                ruleErrors.name = 'Name required!';
              }

              if (values.frontends.filter((f) => f.name === rule.name).length > 1) {
                ruleErrors.name = 'Name must be unique!';
              }

              if (!rule.previewWebhook || !isValidUrl(rule.previewWebhook)) {
                ruleErrors.previewWebhook = 'Please specify an URL!';
              }

              ruleErrors.customHeaders = rule.customHeaders?.map((header) => {
                const headerErrors: Record<string, string> = {};

                if (!header.name) {
                  headerErrors.name = 'Name required!';
                }

                if (rule.customHeaders.filter((h) => h.name === header.name).length > 1) {
                  headerErrors.name = 'Name must be unique!';
                }

                if (!header.value) {
                  headerErrors.value = 'Value required!';
                }

                return headerErrors;
              });

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
              <FieldArray<Frontend> name="frontends">
                {({ fields }) => (
                  <FieldGroup>
                    {fields.map((name, index) => (
                      <div key={name} className={s.group}>
                        <div className={s.grid}>
                          <FieldGroup>
                            <Field name={`${name}.name`}>
                              {({ input, meta: { error } }) => (
                                <TextField
                                  id={`frontend-${index}-name`}
                                  label="Frontend name"
                                  placeholder="Staging"
                                  required
                                  error={error}
                                  {...input}
                                />
                              )}
                            </Field>
                            <Field name={`${name}.previewWebhook`}>
                              {({ input, meta: { error } }) => (
                                <TextField
                                  id={`frontend-${index}-previewWebhook`}
                                  required
                                  label="Previews webhook URL"
                                  placeholder="https://yourwebsite.com/api/preview-links"
                                  error={error}
                                  {...input}
                                />
                              )}
                            </Field>
                            <div>
                              <FormLabel htmlFor="">Custom Headers</FormLabel>
                              <FieldArray<Frontend['customHeaders'][number]> name={`${name}.customHeaders`}>
                                {({ fields }) => (
                                  <FieldGroup>
                                    {fields.map((header, headerIndex) => (
                                      <div key={header} className={s.grid}>
                                        <div className={s.headerGrid}>
                                          <div>
                                            <Field name={`${header}.name`}>
                                              {({ input, meta: { error } }) => (
                                                <TextField
                                                  id={`frontend-${index}-headers-${headerIndex}-name`}
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
                                                  id={`frontend-${index}-headers-${headerIndex}-value`}
                                                  required
                                                  label="Value"
                                                  placeholder="Value"
                                                  error={error}
                                                  {...input}
                                                />
                                              )}
                                            </Field>
                                          </div>
                                        </div>
                                        <Button
                                          type="button"
                                          buttonType="muted"
                                          buttonSize="xxs"
                                          leftIcon={<FontAwesomeIcon icon={faTrash} />}
                                          onClick={() => fields.remove(headerIndex)}
                                        />
                                      </div>
                                    ))}
                                    <Button
                                      type="button"
                                      buttonSize="s"
                                      leftIcon={<FontAwesomeIcon icon={faPlus} />}
                                      onClick={() => fields.push({ name: '', value: '' })}
                                    >
                                      Add new header
                                    </Button>
                                  </FieldGroup>
                                )}
                              </FieldArray>
                            </div>
                          </FieldGroup>
                          <Button
                            type="button"
                            buttonType="negative"
                            buttonSize="xxs"
                            leftIcon={<FontAwesomeIcon icon={faTrash} />}
                            onClick={() => fields.remove(index)}
                          />
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      buttonSize="s"
                      leftIcon={<FontAwesomeIcon icon={faPlus} />}
                      onClick={() =>
                        fields.push({
                          name: '',
                          previewWebhook: '',
                          customHeaders: [],
                        })
                      }
                    >
                      Add new frontend
                    </Button>
                  </FieldGroup>
                )}
              </FieldArray>
            </Section>
            <Section title="Sidebar preview">
              <FieldGroup>
                <Field name="sidebarWidth">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="sidebarWidth"
                      label="Preview width"
                      hint="Specifies the sidebar preview panel initial width"
                      type="number"
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
                <Field name="allowAttribute">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="allowAttribute"
                      label="Iframe allow attribute"
                      hint={
                        <>{'Specifies the iframe allow attribute. '}<a href="https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#allow">Read more.</a></>
                      }
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
              </FieldGroup>
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
