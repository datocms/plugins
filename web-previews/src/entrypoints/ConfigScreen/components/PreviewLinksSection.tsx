import { FieldGroup, SwitchField, TextField } from 'datocms-react-ui';
import { Field } from 'react-final-form';
import type { RawFrontend } from '../../../types';
import s from '../styles.module.css';
import { CustomHeadersList } from './CustomHeadersList';

type Props = {
  name: string;
  index: number;
  frontend: RawFrontend;
};

export function PreviewLinksSection({ name, index, frontend }: Props) {
  return (
    <div className={s.featureSection}>
      <FieldGroup>
        <Field name={`${name}.previewWebhook`}>
          {({ input }) => (
            <SwitchField
              id={`frontend-${index}-enablePreviewLinks`}
              name={`frontend-${index}-enablePreviewLinks`}
              label="Enable Preview Links for this frontend"
              value={!!input.value}
              onChange={(enabled) => {
                input.onChange(enabled ? 'https://' : '');
              }}
            />
          )}
        </Field>

        {frontend?.previewWebhook ? (
          <div className={s.indentFields}>
            <Field name={`${name}.previewWebhook`}>
              {({ input, meta: { error } }) => (
                <FieldGroup>
                  <TextField
                    id={`frontend-${index}-previewWebhook`}
                    label="Preview Links endpoint URL"
                    placeholder="https://yourwebsite.com/api/preview-links"
                    error={error}
                    {...input}
                  />

                  <CustomHeadersList name={name} frontendIndex={index} />
                </FieldGroup>
              )}
            </Field>
          </div>
        ) : undefined}
      </FieldGroup>
    </div>
  );
}
