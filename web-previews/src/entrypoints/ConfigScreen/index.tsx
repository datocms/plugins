import { findIconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  Form,
  Section,
  TextField,
} from 'datocms-react-ui';
import arrayMutators from 'final-form-arrays';
import { useState } from 'react';
import { Field, Form as FormHandler } from 'react-final-form';
import { FieldArray } from 'react-final-form-arrays';
import {
  type Parameters,
  type RawFrontend,
  type RawViewport,
  denormalizeParameters,
  normalizeParameters,
} from '../../types';
import { FrontendFieldItem } from './components/FrontendFieldItem';
import { PreviewLinksSettings } from './components/PreviewLinksSettings';
import { ViewportFieldItem } from './components/ViewportFieldItem';

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
      <FormHandler<Parameters>
        initialValues={denormalizeParameters(
          normalizeParameters(ctx.plugin.attributes.parameters as Parameters),
        )}
        validate={(values) => {
          const errors: Record<string, any> = {};

          errors.frontends = values.frontends?.map((rule: any) => {
            const ruleErrors: Record<string, any> = {};

            if (!rule.name) {
              ruleErrors.name = 'Name required!';
            }

            if (
              (values.frontends?.filter((f: any) => f.name === rule.name)
                .length ?? 0) > 1
            ) {
              ruleErrors.name = 'Name must be unique!';
            }

            // Validate that at least one feature is enabled (using flat structure)
            if (
              !rule.previewWebhook &&
              !rule.visualEditing?.enableDraftModeUrl &&
              !rule.disabled
            ) {
              ruleErrors._error =
                'Enable at least one feature (Preview Links or Visual Editing) or disable this frontend.';
            }

            // Validate preview API endpoint URL if provided (flat structure)
            if (rule.previewWebhook && !isValidUrl(rule.previewWebhook)) {
              ruleErrors.previewWebhook = 'Please specify a valid URL!';
            }

            // Validate custom headers (flat structure)
            ruleErrors.customHeaders = rule.customHeaders?.map(
              (header: any) => {
                const headerErrors: Record<string, string> = {};

                if (!header.name) {
                  headerErrors.name = 'Name required!';
                }

                if (
                  rule.customHeaders &&
                  rule.customHeaders.filter((h: any) => h.name === header.name)
                    .length > 1
                ) {
                  headerErrors.name = 'Name must be unique!';
                }

                if (!header.value) {
                  headerErrors.value = 'Value required!';
                }

                return headerErrors;
              },
            );

            // Validate visual editing URL if provided
            if (rule.visualEditing?.enableDraftModeUrl) {
              if (!isValidUrl(rule.visualEditing.enableDraftModeUrl)) {
                ruleErrors.visualEditing = {
                  enableDraftModeUrl: 'Please specify a valid URL!',
                };
              }
            }

            return ruleErrors;
          });

          errors.defaultViewports = values.defaultViewports?.map((rule) => {
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
              iconName: rule.icon as any,
            });

            if (!definition) {
              ruleErrors.icon = 'Invalid icon!';
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
        {({ handleSubmit, submitting, dirty, values }) => (
          <Form onSubmit={handleSubmit}>
            <Section
              title="Frontends"
              headerStyle={{ marginBottom: 'var(--spacing-m)' }}
            >
              <p>
                Configure your project's frontends and the features each
                provides.
              </p>
              <FieldArray<RawFrontend> name="frontends">
                {({ fields }) => (
                  <FieldGroup>
                    {fields.map((name, index) => (
                      <FrontendFieldItem
                        key={name}
                        name={name}
                        index={index}
                        frontend={fields.value[index]}
                        onRemove={() => fields.remove(index)}
                      />
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
                          visualEditing: {
                            enableDraftModeUrl: '',
                            initialPath: '',
                          },
                        } as any)
                      }
                    >
                      Add new frontend
                    </Button>
                  </FieldGroup>
                )}
              </FieldArray>
            </Section>
            <Section title="Record Sidebar display settings">
              <p>
                Configure display options for preview links shown in the sidebar
                and panel.
              </p>
              <PreviewLinksSettings values={values} />
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
                Configure viewport size presets for testing different screen
                sizes in iframe previews.
              </p>

              <FieldArray<RawViewport> name="defaultViewports">
                {({ fields }) => (
                  <FieldGroup>
                    {fields.map((name, index) => (
                      <ViewportFieldItem
                        key={name}
                        name={name}
                        index={index}
                        onRemove={() => fields.remove(index)}
                      />
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
                          icon: '',
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
              title="Iframe Security Settings"
              collapsible={{
                isOpen: isAdvancedSettingsOpen,
                onToggle: () => setIsAdvancedSettingsOpen((v) => !v),
              }}
            >
              <p>Configure iframe permissions and security settings.</p>
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
