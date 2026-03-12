import { FieldGroup, SwitchField, TextField } from 'datocms-react-ui';
import { Field } from 'react-final-form';
import type { Parameters } from '../../../types';
import s from '../styles.module.css';

type Props = {
  values: Parameters;
};

export function PreviewLinksSettings({ values }: Props) {
  return (
    <FieldGroup>
      {/* Sidebar Panel Toggle */}
      <div className={s.featureSection}>
        <FieldGroup>
          <Field name="previewLinksSidebarPanelDisabled">
            {({ input }) => (
              <SwitchField
                id="previewLinksSidebarPanelEnabled"
                name="previewLinksSidebarPanelEnabled"
                label="Enable Preview Links sidebar panel"
                hint={
                  <>
                    Show a "Related website pages" panel in the record sidebar
                    with links to preview URLs.{' '}
                    <a
                      href="https://www.datocms.com/marketplace/plugins/i/datocms-plugin-web-previews#sidebar-panel"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Learn more
                    </a>
                  </>
                }
                value={!input.value}
                onChange={(enabled) => {
                  input.onChange(!enabled);
                }}
              />
            )}
          </Field>

          {!values.previewLinksSidebarPanelDisabled ? (
            <div className={s.indentFields}>
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
            </div>
          ) : null}
        </FieldGroup>
      </div>

      {/* Full Sidebar Toggle */}
      <div className={s.featureSection}>
        <FieldGroup>
          <Field name="previewLinksSidebarDisabled">
            {({ input }) => (
              <SwitchField
                id="previewLinksSidebarEnabled"
                name="previewLinksSidebarEnabled"
                label="Enable Preview Links full-preview sidebar"
                hint={
                  <>
                    Show a full "Website preview" sidebar with an iframe preview
                    of the selected URL.{' '}
                    <a
                      href="https://www.datocms.com/marketplace/plugins/i/datocms-plugin-web-previews#full-preview-sidebar"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Learn more
                    </a>
                  </>
                }
                value={!input.value}
                onChange={(enabled) => {
                  input.onChange(!enabled);
                }}
              />
            )}
          </Field>

          {!values.previewLinksSidebarDisabled ? (
            <div className={s.indentFields}>
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
            </div>
          ) : null}
        </FieldGroup>
      </div>
    </FieldGroup>
  );
}
