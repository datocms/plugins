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
      {/* Visual Tab Toggle */}
      <div>
        <Field name="showVisualTab">
          {({ input, meta: { error } }) => (
            <SwitchField
              id="showVisualTab"
              label="Show the Visual tab in the main navigation"
              error={error}
              {...input}
            />
          )}
        </Field>
      </div>

      {/* Sidebar Panel Toggle */}
      <div>
        <FieldGroup>
          <Field name="previewLinksSidebarPanelDisabled">
            {({ input }) => (
              <SwitchField
                id="previewLinksSidebarPanelEnabled"
                name="previewLinksSidebarPanelEnabled"
                label="Show Preview Links in a record sidebar panel"
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
                      label="Start with the panel expanded"
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

      {/* Record Form Toggle */}
      <div>
        <Field name="previewLinksFormOutlet">
          {({ input, meta: { error } }) => (
            <SwitchField
              id="previewLinksFormOutlet"
              label="Show Preview Links at the top of the record form"
              error={error}
              {...input}
            />
          )}
        </Field>
      </div>

      {/* Full Sidebar Toggle */}
      <div>
        <FieldGroup>
          <Field name="previewLinksSidebarDisabled">
            {({ input }) => (
              <SwitchField
                id="previewLinksSidebarEnabled"
                name="previewLinksSidebarEnabled"
                label="Show the Website preview tab in the record sidebar"
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
                      label="Default tab width (px)"
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
