import type { IconName } from '@fortawesome/fontawesome-svg-core';
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
  denormalizeParameters,
  normalizeParameters,
  type Parameters,
  type RawFrontend,
  type RawViewport,
} from '../../types';
import { FrontendFieldItem } from './components/FrontendFieldItem';
import { PreviewLinksSettings } from './components/PreviewLinksSettings';
import { ViewportFieldItem } from './components/ViewportFieldItem';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

type CustomHeader = {
  name: string;
  value: string;
};

type FrontendErrors = {
  name?: string;
  _error?: string;
  previewWebhook?: string;
  customHeaders?: Record<string, string>[];
  visualEditing?: { enableDraftModeUrl?: string };
};

type ViewportErrors = {
  name?: string;
  width?: string;
  height?: string;
  icon?: string;
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

function isValidIconName(iconString: string): iconString is IconName {
  const definition = findIconDefinition({
    prefix: 'fas',
    iconName: iconString as IconName,
  });
  return Boolean(definition);
}

function validateCustomHeaders(
  headers: CustomHeader[] | undefined,
): Record<string, string>[] | undefined {
  return headers?.map((header) => {
    const headerErrors: Record<string, string> = {};

    if (!header.name) {
      headerErrors.name = 'Name required!';
    }

    const isDuplicateHeaderName =
      headers.filter((h) => h.name === header.name).length > 1;

    if (isDuplicateHeaderName) {
      headerErrors.name = 'Name must be unique!';
    }

    if (!header.value) {
      headerErrors.value = 'Value required!';
    }

    return headerErrors;
  });
}

function validateFrontend(
  rule: RawFrontend,
  allFrontends: RawFrontend[],
): FrontendErrors {
  const ruleErrors: FrontendErrors = {};

  if (!rule.name) {
    ruleErrors.name = 'Name required!';
  }

  const isDuplicateName =
    (allFrontends.filter((f) => f.name === rule.name).length ?? 0) > 1;

  if (isDuplicateName) {
    ruleErrors.name = 'Name must be unique!';
  }

  const hasNoFeatureEnabled =
    !rule.previewWebhook &&
    !rule.visualEditing?.enableDraftModeUrl &&
    !rule.disabled;

  if (hasNoFeatureEnabled) {
    ruleErrors._error =
      'Enable at least one feature (Preview Links or Visual Editing) or disable this frontend.';
  }

  if (rule.previewWebhook && !isValidUrl(rule.previewWebhook)) {
    ruleErrors.previewWebhook = 'Please specify a valid URL!';
  }

  const customHeaderErrors = validateCustomHeaders(rule.customHeaders);
  if (customHeaderErrors) {
    ruleErrors.customHeaders = customHeaderErrors;
  }

  if (rule.visualEditing?.enableDraftModeUrl) {
    if (!isValidUrl(rule.visualEditing.enableDraftModeUrl)) {
      ruleErrors.visualEditing = {
        enableDraftModeUrl: 'Please specify a valid URL!',
      };
    }
  }

  return ruleErrors;
}

function validateViewport(rule: RawViewport): ViewportErrors {
  const ruleErrors: ViewportErrors = {};

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
  } else if (!isValidIconName(rule.icon)) {
    ruleErrors.icon = 'Invalid icon!';
  }

  return ruleErrors;
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
          const errors: Record<string, unknown> = {};

          errors.frontends = values.frontends?.map((rule) => {
            return validateFrontend(rule, values.frontends ?? []);
          });

          errors.defaultViewports = values.defaultViewports?.map((rule) => {
            return validateViewport(rule);
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
                        })
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
