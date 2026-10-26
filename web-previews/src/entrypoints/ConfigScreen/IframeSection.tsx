import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import StringInput from 'datocms-react-ui/StringInput';
import { useState } from 'react';
import { DocLinks } from './DocLinks';
import { IFRAME_ALLOW_DOCS_URL, IFRAME_DOC_LINKS } from './links';
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
            <p>What the website can do inside the preview.</p>
            <DocLinks links={IFRAME_DOC_LINKS} />
          </Page.SectionDescription>
          <FieldWrapper
            label="Allow attribute"
            hint="The allow attribute of the preview iframe, for example to use the camera or the microphone."
            docs={{
              label: 'The allow attribute on MDN',
              to: IFRAME_ALLOW_DOCS_URL,
            }}
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
