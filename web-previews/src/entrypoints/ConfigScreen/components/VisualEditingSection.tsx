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
              label="This frontend supports Visual Editing"
              hint="Enable full-screen, side-by-side editing with click-to-edit overlays. Requires your frontend to implement draft mode, and integrate with DatoCMS Content Link SDKs."
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
                    label="Enable Draft Mode route"
                    placeholder="https://yourwebsite.com/api/draft"
                    error={error}
                    hint={
                      <>
                        The route that enables draft/preview mode. Receives a{' '}
                        <code>redirect</code> query parameter with the path to
                        load.{' '}
                        <a
                          href="https://www.datocms.com/marketplace/plugins/i/datocms-plugin-web-previews#the-enable-draft-mode-route"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Learn more
                        </a>
                      </>
                    }
                    {...input}
                  />

                  <Field name={`${name}.visualEditing.initialPath`}>
                    {({ input, meta: { error } }) => (
                      <TextField
                        id={`frontend-${index}-visualEditing-initialPath`}
                        label="Initial Path (Optional)"
                        placeholder="/"
                        hint="The default frontend path to load when opening Visual Editing. Defaults to '/'."
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
