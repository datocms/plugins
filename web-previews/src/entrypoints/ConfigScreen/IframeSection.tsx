import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import StringInput from 'datocms-react-ui/StringInput';
import { useState } from 'react';
import { CSP_DOCS_URL, DOCS } from './links';
import type { SettingsForm } from './useSettingsForm';

type Props = {
  form: SettingsForm;
};

/** The permissions of the preview iframe, closed at first */
export function IframeSection({ form }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Page.Section>
      <Page.SectionTitle collapse={{ open, onToggle: () => setOpen(!open) }}>
        Iframe permissions
      </Page.SectionTitle>
      {open && (
        <>
          <Page.SectionDescription>
            <p>
              What the website can do inside the preview. If the preview stays
              blank, the website may need to allow DatoCMS in its{' '}
              <a href={CSP_DOCS_URL} target="_blank" rel="noreferrer">
                Content Security Policy
              </a>
              .
            </p>
          </Page.SectionDescription>
          <FieldWrapper
            label="Allow attribute"
            hint="Permissions separated by semicolons."
            docs={DOCS.allowAttribute}
          >
            <StringInput
              code
              placeholder="camera; microphone"
              value={form.draft.iframeAllowAttribute ?? ''}
              onChange={(allow) =>
                form.update({ iframeAllowAttribute: allow ?? '' })
              }
            />
          </FieldWrapper>
        </>
      )}
    </Page.Section>
  );
}
