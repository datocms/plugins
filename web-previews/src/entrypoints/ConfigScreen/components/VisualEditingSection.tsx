import { FieldGroup, SwitchField, TextField } from 'datocms-react-ui';
import { Field } from 'react-final-form';
import type { RawFrontend } from '../../../types';
import s from '../styles.module.css';

type Props = {
  name: string;
  index: number;
  frontend: RawFrontend;
};

export function VisualEditingSection({ name, index, frontend }: Props) {
  return (
    <div className={s.featureSection}>
      <FieldGroup>
        <Field name={`${name}.visualEditing.enableDraftModeUrl`}>
          {({ input }) => (
            <SwitchField
              id={`frontend-${index}-enableVisualEditing`}
              name={`frontend-${index}-enableVisualEditing`}
              label="Enable Visual Editing for this frontend"
              value={!!input.value}
              onChange={(enabled) => {
                input.onChange(enabled ? 'https://' : '');
              }}
            />
          )}
        </Field>

        {frontend?.visualEditing?.enableDraftModeUrl ? (
          <div className={s.indentFields}>
            <Field name={`${name}.visualEditing.enableDraftModeUrl`}>
              {({ input, meta: { error } }) => (
                <FieldGroup>
                  <TextField
                    id={`frontend-${index}-visualEditing-enableDraftModeUrl`}
                    label="Draft mode URL"
                    placeholder="https://yourwebsite.com/api/draft"
                    error={error}
                    {...input}
                  />

                  <Field name={`${name}.visualEditing.initialPath`}>
                    {({ input, meta: { error } }) => (
                      <TextField
                        id={`frontend-${index}-visualEditing-initialPath`}
                        label="Start page (optional)"
                        placeholder="/"
                        error={error}
                        {...input}
                      />
                    )}
                  </Field>
                </FieldGroup>
              )}
            </Field>
          </div>
        ) : null}
      </FieldGroup>
    </div>
  );
}
