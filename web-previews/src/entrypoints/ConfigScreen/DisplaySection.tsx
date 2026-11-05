import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import { Page } from 'datocms-react-ui/Page';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import SwitchList from 'datocms-react-ui/SwitchList';
import { useState } from 'react';
import s from './styles.module.css';
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
          </Page.SectionDescription>
          <SwitchList className={s.switches}>
            <SwitchInput
              label="Show the Visual Editing tab in the main navigation"
              value={draft.showVisualTab ?? true}
              onChange={(on) => update({ showVisualTab: Boolean(on) })}
            />
            <SwitchInput
              label="Show Preview Links in a record sidebar panel"
              value={panelOn}
              onChange={(on) =>
                update({ previewLinksSidebarPanelDisabled: !on })
              }
            />
            {/* Only for the panel, thus right under its switch */}
            {panelOn && (
              <SwitchInput
                label="Start with the panel expanded"
                value={Boolean(draft.startOpen)}
                onChange={(on) => update({ startOpen: Boolean(on) })}
              />
            )}
            <SwitchInput
              label="Show Preview Links at the top of the record form"
              value={draft.previewLinksFormOutlet ?? true}
              onChange={(on) => update({ previewLinksFormOutlet: Boolean(on) })}
            />
            <SwitchInput
              label="Show the Website preview tab in the record sidebar"
              value={sidebarOn}
              onChange={(on) => update({ previewLinksSidebarDisabled: !on })}
            />
          </SwitchList>
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
