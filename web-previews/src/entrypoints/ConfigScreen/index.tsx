import { findIconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  type IconName,
  faPlus,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  FieldWrapper,
  Form,
  FormLabel,
  Section,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
import arrayMutators from 'final-form-arrays';
import { useState } from 'react';
import { Field, Form as FormHandler } from 'react-final-form';
import { FieldArray } from 'react-final-form-arrays';
import {
  type Frontend,
  type NormalizedParameters,
  type Parameters,
  type Viewport,
  normalizeParameters,
} from '../../types';
import { IconPickerInput } from './IconPickerInput';
import s from './styles.module.css';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

function isValidUrl(string: string) {
  let url: URL;
  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

export default function ConfigScreen({ ctx }: PropTypes) {
  const [isCustomViewportsOpen, setIsCustomViewportsOpen] = useState(false);
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);

  return (
    <Canvas ctx={ctx}>
      <FormHandler<NormalizedParameters>
        initialValues={normalizeParameters(
          ctx.plugin.attributes.parameters as Parameters,
        )}
        validate={(values) => {
          const errors: Record<string, any> = {};

          errors.frontends = values.frontends.map((rule) => {
            const ruleErrors: Record<string, any> = {};

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

            ruleErrors.customHeaders = rule.customHeaders?.map((header) => {
              const headerErrors: Record<string, string> = {};

              if (!header.name) {
                headerErrors.name = 'Name required!';
              }

              if (
                rule.customHeaders &&
                rule.customHeaders.filter((h) => h.name === header.name)
                  .length > 1
              ) {
                headerErrors.name = 'Name must be unique!';
              }

              if (!header.value) {
                headerErrors.value = 'Value required!';
              }

              return headerErrors;
            });

            return ruleErrors;
          });

          errors.defaultViewports = values.defaultViewports.map((rule) => {
            const ruleErrors: Record<string, string> = {};

            if (!rule.name) {
              ruleErrors.name = 'Name required!';
            }

            if (!rule.width) {
              ruleErrors.width = 'Width required!';
            }

            if (!rule.height) {
              ruleErrors.height = 'Height required!';
            }

            if (!rule.icon) {
              ruleErrors.icon = 'Icon required!';
            }

            const definition = findIconDefinition({
              prefix: 'fas',
              iconName: rule.icon,
            });

            if (!definition) {
              ruleErrors.icon = 'Invalid icon!';
            }

            return ruleErrors;
          });

          if (values.visualEditing) {
            const visualEditingErrors: Record<string, any> = {};

            if (
              values.visualEditing.enableDraftModeUrl &&
              !isValidUrl(values.visualEditing.enableDraftModeUrl)
            ) {
              visualEditingErrors.enableDraftModeUrl =
                'Please specify a valid URL!';
            }

            errors.visualEditing = visualEditingErrors;
          }

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
                preview links.
              </p>
              <FieldArray<Frontend> name="frontends">
                {({ fields }) => (
                  <FieldGroup>
                    {fields.map((name, index) => (
                      <div key={name} className={s.group}>
                        <div className={s.grid}>
                          <FieldGroup>
                            <Field name={`${name}.disabled`}>
                              {({ input, meta: { error } }) => (
                                <SwitchField
                                  id={`frontend-${index}-disabled`}
                                  label="Enable this frontend?"
                                  hint="Toggle this frontend on or off. Disabled frontends remain configured but won't be visible to editors."
                                  error={error}
                                  {...{
                                    ...input,
                                    value: !input.value,
                                    checked: !input.checked,
                                    onChange: (value) => input.onChange(!value),
                                  }}
                                />
                              )}
                            </Field>
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
                                  label="Webhook URL"
                                  placeholder="https://yourwebsite.com/api/preview-links"
                                  error={error}
                                  hint={
                                    <>
                                      Read more about the JSON output required
                                      by Web Preview webhooks in the{' '}
                                      <a
                                        href="https://www.datocms.com/marketplace/plugins/i/datocms-plugin-web-previews#the-previews-webhook"
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        README
                                      </a>
                                      .
                                    </>
                                  }
                                  {...input}
                                />
                              )}
                            </Field>

                            <div>
                              <FormLabel htmlFor="">Custom Headers</FormLabel>
                              <FieldArray<
                                NonNullable<Frontend['customHeaders']>[number]
                              >
                                name={`${name}.customHeaders`}
                              >
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
                                          leftIcon={
                                            <FontAwesomeIcon icon={faTrash} />
                                          }
                                          onClick={() =>
                                            fields.remove(headerIndex)
                                          }
                                        />
                                      </div>
                                    ))}
                                    <Button
                                      type="button"
                                      buttonSize="s"
                                      leftIcon={
                                        <FontAwesomeIcon icon={faPlus} />
                                      }
                                      onClick={() =>
                                        fields.push({ name: '', value: '' })
                                      }
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
                          disabled: false,
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
            <Section title="Web Previews sidebar">
              <FieldGroup>
                <Field name="defaultSidebarWidth">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="sidebarWidth"
                      label="Default sidebar width (px)"
                      hint="Specify the initial width for the sidebar"
                      type="number"
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
              </FieldGroup>
            </Section>
            <Section title="Web Previews panel">
              <FieldGroup>
                <Field name="startOpen">
                  {({ input, meta: { error } }) => (
                    <SwitchField
                      id="startOpen"
                      label="Start with the sidebar panel open?"
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
              </FieldGroup>
            </Section>
            <Section title="Visual Editing">
              <FieldGroup>
                <Field name="visualEditing.enableDraftModeUrl">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="visualEditing.enableDraftModeUrl"
                      label="Enable Draft Mode URL"
                      placeholder="https://yourwebsite.com/api/draft"
                      hint="URL endpoint to enable draft/preview mode in your frontend application"
                      error={error}
                      {...input}
                    />
                  )}
                </Field>

                <Field name="visualEditing.initialPath">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="visualEditing.initialPath"
                      label="Initial path"
                      placeholder="/"
                      hint="The initial path to load when Visual Editing is opened"
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
              </FieldGroup>
            </Section>
            <Section
              title="Custom viewports"
              headerStyle={{ marginBottom: 'var(--spacing-m)' }}
              collapsible={{
                isOpen: isCustomViewportsOpen,
                onToggle: () => setIsCustomViewportsOpen((v) => !v),
              }}
            >
              <p>
                Please configure the predefined list of viewports that will be
                offered in the sidebar:
              </p>

              <FieldArray<Viewport> name="defaultViewports">
                {({ fields }) => (
                  <FieldGroup>
                    {fields.map((name, index) => (
                      <div key={name} className={s.group}>
                        <div className={s.grid}>
                          <FieldGroup>
                            <div className={s.viewportGrid}>
                              <div>
                                <Field name={`${name}.name`}>
                                  {({ input, meta: { error } }) => (
                                    <TextField
                                      id={`custom-viewport-${index}-name`}
                                      label="Viewport name"
                                      placeholder="Tablet"
                                      required
                                      error={error}
                                      {...input}
                                    />
                                  )}
                                </Field>
                              </div>
                              <div>
                                <Field name={`${name}.icon`}>
                                  {({ input, meta: { error } }) => (
                                    <FieldWrapper
                                      id={`custom-viewport-${index}-icon`}
                                      label="Icon"
                                      required
                                      error={error}
                                    >
                                      <IconPickerInput
                                        {...input}
                                        error={error}
                                      />
                                    </FieldWrapper>
                                  )}
                                </Field>
                              </div>
                              <div>
                                <Field name={`${name}.width`}>
                                  {({ input, meta: { error } }) => (
                                    <TextField
                                      id={`custom-viewport-${index}-width`}
                                      required
                                      label="Viewport width (px)"
                                      error={error}
                                      {...input}
                                    />
                                  )}
                                </Field>
                              </div>
                              <div>
                                <Field name={`${name}.height`}>
                                  {({ input, meta: { error } }) => (
                                    <TextField
                                      id={`custom-viewport-${index}-height`}
                                      required
                                      label="Viewport Height (px)"
                                      error={error}
                                      {...input}
                                    />
                                  )}
                                </Field>
                              </div>
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
                          width: 0,
                          height: 0,
                          icon: '' as IconName,
                        })
                      }
                    >
                      Add new viewport
                    </Button>
                  </FieldGroup>
                )}
              </FieldArray>
            </Section>
            <Section
              title="Advanced settings"
              collapsible={{
                isOpen: isAdvancedSettingsOpen,
                onToggle: () => setIsAdvancedSettingsOpen((v) => !v),
              }}
            >
              <FieldGroup>
                <Field name="iframeAllowAttribute">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="iframeAllowAttribute"
                      label={
                        <>
                          Iframe <code>allow</code> attribute
                        </>
                      }
                      hint={
                        <>
                          Defines what features will be available to the{' '}
                          <code>&lt;iframe&gt;</code> pointing to the frontend
                          (ie. access to the microphone, camera).{' '}
                          <a
                            href="https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#allow"
                            rel="noreferrer"
                            target="_blank"
                          >
                            Read more
                          </a>
                        </>
                      }
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
