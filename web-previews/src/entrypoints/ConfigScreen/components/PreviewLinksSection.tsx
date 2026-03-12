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
              label="This frontend offers Preview Links"
              hint="Show preview links for this frontend in the sidebar. Requires your frontend to offer an endpoint returning them."
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
                    label="Preview Links API Endpoint"
                    placeholder="https://yourwebsite.com/api/preview-links"
                    error={error}
                    hint={
                      <>
                        URL of the POST JSON endpoint that returns preview URLs
                        given a specific record as request payload.{' '}
                        <a
                          href="https://www.datocms.com/marketplace/plugins/i/datocms-plugin-web-previews#the-preview-links-api-endpoint"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Learn more
                        </a>
                      </>
                    }
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
