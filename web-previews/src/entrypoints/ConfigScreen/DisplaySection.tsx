import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import { Page } from 'datocms-react-ui/Page';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { useState } from 'react';
import { DocLinks } from './DocLinks';
import { DISPLAY_DOC_LINKS } from './links';
import type { SettingsForm } from './useSettingsForm';

type Props = {
  form: SettingsForm;
};

/**
 * Where editors find the plugin: the Visual Editing tab, the panel, the top
 * of the record form, the Website preview tab. Closed at first.
 */
export function DisplaySection({ form }: Props) {
  const { draft, update } = form;
  const panelOn = !draft.previewLinksSidebarPanelDisabled;
  const sidebarOn = !draft.previewLinksSidebarDisabled;
  const widthError = form.showsError('defaultSidebarWidth')
    ? form.errors.defaultSidebarWidth
    : undefined;
  const [userOpen, setUserOpen] = useState(false);
  // A section that shows an error can't close until the error is fixed
  const locked = sidebarOn && Boolean(widthError);
  const open = userOpen || locked;

  return (
    <Page.Section>
      <Page.SectionTitle
        collapse={{
          open,
          onToggle: locked ? undefined : () => setUserOpen(!userOpen),
        }}
      >
        Display
      </Page.SectionTitle>
      {open && (
        <>
          <Page.SectionDescription>
            <p>Where editors find Web Previews.</p>
            <DocLinks links={DISPLAY_DOC_LINKS} />
          </Page.SectionDescription>
          <FieldWrapper>
            <SwitchInput
              label="Show the Visual Editing tab in the main navigation"
              value={draft.showVisualTab ?? true}
              onChange={(on) => update({ showVisualTab: Boolean(on) })}
            />
          </FieldWrapper>
          <FieldWrapper>
            <SwitchInput
              label="Show Preview Links in a record sidebar panel"
              value={panelOn}
              onChange={(on) =>
                update({ previewLinksSidebarPanelDisabled: !on })
              }
            />
          </FieldWrapper>
          {/* The fields that show only while the switch above is on */}
          {panelOn && (
            <Page.Group title="Preview links panel" titleLevel={3}>
              <FieldWrapper>
                <SwitchInput
                  label="Start with the panel expanded"
                  value={Boolean(draft.startOpen)}
                  onChange={(on) => update({ startOpen: Boolean(on) })}
                />
              </FieldWrapper>
            </Page.Group>
          )}
          <FieldWrapper>
            <SwitchInput
              label="Show Preview Links at the top of the record form"
              value={Boolean(draft.previewLinksFormOutlet)}
              onChange={(on) => update({ previewLinksFormOutlet: Boolean(on) })}
            />
          </FieldWrapper>
          <FieldWrapper>
            <SwitchInput
              label="Show the Website preview tab in the record sidebar"
              value={sidebarOn}
              onChange={(on) => update({ previewLinksSidebarDisabled: !on })}
            />
          </FieldWrapper>
          {sidebarOn && (
            <Page.Group title="Website preview tab" titleLevel={3}>
              <FieldWrapper label="Default tab width" error={widthError}>
                <InputGroup
                  post="px"
                  inputMode="numeric"
                  placeholder="900"
                  value={draft.defaultSidebarWidth ?? ''}
                  onChange={(width) =>
                    update({ defaultSidebarWidth: width ?? '' })
                  }
                  onBlur={() => form.touchField('defaultSidebarWidth')}
                />
              </FieldWrapper>
            </Page.Group>
          )}
        </>
      )}
    </Page.Section>
  );
}
