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

          errors.frontends = values.frontends.map((rule: any) => {
            const ruleErrors: Record<string, any> = {};

            if (!rule.name) {
              ruleErrors.name = 'Name required!';
            }

            if (
              values.frontends.filter((f: any) => f.name === rule.name).length >
              1
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

            // Validate preview webhook URL if provided (flat structure)
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

                            {/* ========== SECTION 1: PREVIEW LINKS ========== */}
                            <div className={s.featureSection}>
                              <div className={s.featureHeader}>
                                <div className={s.featureTitle}>
                                  Preview Links
                                </div>
                                <Field name={`${name}.previewWebhook`}>
                                  {({ input }) => (
                                    <SwitchField
                                      id={`frontend-${index}-enablePreviewLinks`}
                                      name={`frontend-${index}-enablePreviewLinks`}
                                      label="Enable"
                                      value={!!input.value}
                                      onChange={(enabled) => {
                                        input.onChange(
                                          enabled ? 'https://' : '',
                                        );
                                      }}
                                    />
                                  )}
                                </Field>
                              </div>

                              <p className={s.featureDescription}>
                                Show preview links in the sidebar. Preview links
                                can display draft or published content from any
                                environment.
                              </p>

                              <Field name={`${name}.previewWebhook`}>
                                {({ input, meta: { error } }) =>
                                  input.value ? (
                                    <FieldGroup>
                                      <TextField
                                        id={`frontend-${index}-previewWebhook`}
                                        label="Webhook URL"
                                        placeholder="https://yourwebsite.com/api/preview-links"
                                        error={error}
                                        hint={
                                          <>
                                            This webhook returns preview links.{' '}
                                            <a
                                              href="https://www.datocms.com/marketplace/plugins/i/datocms-plugin-web-previews#the-previews-webhook"
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              Learn more
                                            </a>
                                          </>
                                        }
                                        {...input}
                                      />

                                      {/* Custom Headers */}
                                      <div>
                                        <div
                                          style={{
                                            fontWeight: 600,
                                            marginBottom: 'var(--spacing-s)',
                                          }}
                                        >
                                          Custom Headers (Optional)
                                        </div>
                                        <FieldArray
                                          name={`${name}.customHeaders`}
                                        >
                                          {({ fields }) => (
                                            <FieldGroup>
                                              {fields.map(
                                                (header, headerIndex) => (
                                                  <div
                                                    key={header}
                                                    className={s.grid}
                                                  >
                                                    <div
                                                      className={s.headerGrid}
                                                    >
                                                      <Field
                                                        name={`${header}.name`}
                                                      >
                                                        {({
                                                          input,
                                                          meta: { error },
                                                        }) => (
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
                                                      <Field
                                                        name={`${header}.value`}
                                                      >
                                                        {({
                                                          input,
                                                          meta: { error },
                                                        }) => (
                                                          <TextField
                                                            id={`frontend-${index}-headers-${headerIndex}-value`}
                                                            label="Value"
                                                            placeholder="Value"
                                                            required
                                                            error={error}
                                                            {...input}
                                                          />
                                                        )}
                                                      </Field>
                                                    </div>
                                                    <Button
                                                      type="button"
                                                      buttonType="muted"
                                                      buttonSize="xxs"
                                                      leftIcon={
                                                        <FontAwesomeIcon
                                                          icon={faTrash}
                                                        />
                                                      }
                                                      onClick={() =>
                                                        fields.remove(
                                                          headerIndex,
                                                        )
                                                      }
                                                    />
                                                  </div>
                                                ),
                                              )}
                                              <Button
                                                type="button"
                                                buttonSize="s"
                                                leftIcon={
                                                  <FontAwesomeIcon
                                                    icon={faPlus}
                                                  />
                                                }
                                                onClick={() =>
                                                  fields.push({
                                                    name: '',
                                                    value: '',
                                                  })
                                                }
                                              >
                                                Add header
                                              </Button>
                                            </FieldGroup>
                                          )}
                                        </FieldArray>
                                      </div>
                                    </FieldGroup>
                                  ) : null
                                }
                              </Field>
                            </div>

                            {/* ========== SECTION 2: VISUAL EDITING ========== */}
                            <div className={s.featureSection}>
                              <div className={s.featureHeader}>
                                <div className={s.featureTitle}>
                                  Visual Editing
                                </div>
                                <Field
                                  name={`${name}.visualEditing.enableDraftModeUrl`}
                                >
                                  {({ input }) => (
                                    <SwitchField
                                      id={`frontend-${index}-enableVisualEditing`}
                                      name={`frontend-${index}-enableVisualEditing`}
                                      label="Enable"
                                      value={!!input.value}
                                      onChange={(enabled) => {
                                        input.onChange(
                                          enabled ? 'https://' : '',
                                        );
                                      }}
                                    />
                                  )}
                                </Field>
                              </div>

                              <p className={s.featureDescription}>
                                Enable full-screen, side-by-side editing with
                                click-to-edit overlays. Requires your frontend
                                to implement a draft mode API endpoint.
                              </p>

                              <Field
                                name={`${name}.visualEditing.enableDraftModeUrl`}
                              >
                                {({ input, meta: { error } }) =>
                                  input.value ? (
                                    <FieldGroup>
                                      <TextField
                                        id={`frontend-${index}-visualEditing-enableDraftModeUrl`}
                                        label="Draft Mode API Endpoint"
                                        placeholder="https://yourwebsite.com/api/draft"
                                        error={error}
                                        hint={
                                          <>
                                            The API route that enables
                                            draft/preview mode. Receives a{' '}
                                            <code>redirect</code> query
                                            parameter with the path to load.{' '}
                                            <a
                                              href="https://www.datocms.com/docs/content-delivery-api/draft-mode"
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              Learn more
                                            </a>
                                          </>
                                        }
                                        {...input}
                                      />

                                      <Field
                                        name={`${name}.visualEditing.initialPath`}
                                      >
                                        {({ input, meta: { error } }) => (
                                          <TextField
                                            id={`frontend-${index}-visualEditing-initialPath`}
                                            label="Initial Path (Optional)"
                                            placeholder="/"
                                            hint="The default path to load when opening Visual Editing. Defaults to '/' if not specified."
                                            error={error}
                                            {...input}
                                          />
                                        )}
                                      </Field>
                                    </FieldGroup>
                                  ) : null
                                }
                              </Field>
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
            <Section title="Preview Links Settings">
              <p>
                Configure display options for preview links shown in the sidebar
                and panel.
              </p>
              <FieldGroup>
                {/* Sidebar Panel Toggle */}
                <div className={s.featureSection}>
                  <div className={s.featureHeader}>
                    <div className={s.featureTitle}>Sidebar Panel</div>
                    <Field name="previewLinksSidebarPanelDisabled">
                      {({ input }) => (
                        <SwitchField
                          id="previewLinksSidebarPanelEnabled"
                          name="previewLinksSidebarPanelEnabled"
                          label="Enable"
                          value={!input.value}
                          onChange={(enabled) => {
                            input.onChange(!enabled);
                          }}
                        />
                      )}
                    </Field>
                  </div>

                  <p className={s.featureDescription}>
                    Show a small panel in the record sidebar with quick links to
                    preview URLs.
                  </p>

                  <Field name="previewLinksSidebarPanelDisabled">
                    {({ input }) =>
                      !input.value ? (
                        <FieldGroup>
                          <Field name="startOpen">
                            {({ input, meta: { error } }) => (
                              <SwitchField
                                id="startOpen"
                                label="Start with the panel open by default?"
                                hint="The panel will be expanded when users open a record"
                                error={error}
                                {...input}
                              />
                            )}
                          </Field>
                        </FieldGroup>
                      ) : null
                    }
                  </Field>
                </div>

                {/* Full Sidebar Toggle */}
                <div className={s.featureSection}>
                  <div className={s.featureHeader}>
                    <div className={s.featureTitle}>Full Preview Sidebar</div>
                    <Field name="previewLinksSidebarDisabled">
                      {({ input }) => (
                        <SwitchField
                          id="previewLinksSidebarEnabled"
                          name="previewLinksSidebarEnabled"
                          label="Enable"
                          value={!input.value}
                          onChange={(enabled) => {
                            input.onChange(!enabled);
                          }}
                        />
                      )}
                    </Field>
                  </div>

                  <p className={s.featureDescription}>
                    Show a full sidebar with an iframe preview of the selected
                    URL.
                  </p>

                  <Field name="previewLinksSidebarDisabled">
                    {({ input }) =>
                      !input.value ? (
                        <FieldGroup>
                          <Field name="defaultSidebarWidth">
                            {({ input, meta: { error } }) => (
                              <TextField
                                id="defaultSidebarWidth"
                                label="Default sidebar width (px)"
                                hint="The initial width when the sidebar is opened"
                                type="number"
                                error={error}
                                {...input}
                              />
                            )}
                          </Field>
                        </FieldGroup>
                      ) : null
                    }
                  </Field>
                </div>
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
