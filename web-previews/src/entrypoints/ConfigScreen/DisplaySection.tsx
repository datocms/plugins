import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import { Page } from 'datocms-react-ui/Page';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { MARKETPLACE_URL } from './links';
import type { SettingsForm } from './useSettingsForm';

type Props = {
  form: SettingsForm;
};

/** Where editors find the plugin: the Visual tab, the panel, the sidebar */
export function DisplaySection({ form }: Props) {
  const { draft, update } = form;
  const panelOn = !draft.previewLinksSidebarPanelDisabled;
  const sidebarOn = !draft.previewLinksSidebarDisabled;

  return (
    <Page.Section>
      <Page.SectionTitle>Display</Page.SectionTitle>
      <Page.SectionDescription>
        Where editors find Web Previews.
      </Page.SectionDescription>
      <FieldWrapper hint="Adds the Visual tab to the main navigation when a frontend offers visual editing.">
        <SwitchInput
          label="Visual tab"
          value={draft.showVisualTab ?? true}
          onChange={(on) => update({ showVisualTab: Boolean(on) })}
        />
      </FieldWrapper>
      <FieldWrapper
        hint="Adds a “Related website pages” panel to the record sidebar."
        docs={{
          label: 'About the panel',
          to: `${MARKETPLACE_URL}#sidebar-panel`,
        }}
      >
        <SwitchInput
          label="Preview links panel"
          value={panelOn}
          onChange={(on) => update({ previewLinksSidebarPanelDisabled: !on })}
        />
      </FieldWrapper>
      {/* The fields that show only while the switch above is on */}
      {panelOn && (
        <Page.Group title="Preview links panel" titleLevel={3}>
          <FieldWrapper hint="The panel is open when an editor opens a record.">
            <SwitchInput
              label="Starts open"
              value={Boolean(draft.startOpen)}
              onChange={(on) => update({ startOpen: Boolean(on) })}
            />
          </FieldWrapper>
        </Page.Group>
      )}
      <FieldWrapper
        hint="Adds a “Website preview” sidebar to the record editor, with a live preview of the page."
        docs={{
          label: 'About the sidebar',
          to: `${MARKETPLACE_URL}#full-preview-sidebar`,
        }}
      >
        <SwitchInput
          label="Website preview sidebar"
          value={sidebarOn}
          onChange={(on) => update({ previewLinksSidebarDisabled: !on })}
        />
      </FieldWrapper>
      {sidebarOn && (
        <Page.Group title="Website preview sidebar" titleLevel={3}>
          <FieldWrapper
            label="Default width"
            hint="The width of the sidebar until an editor resizes it."
            error={
              form.showsError('defaultSidebarWidth')
                ? form.errors.defaultSidebarWidth
                : undefined
            }
          >
            <InputGroup
              post="px"
              inputMode="numeric"
              placeholder="900"
              value={draft.defaultSidebarWidth ?? ''}
              onChange={(width) => update({ defaultSidebarWidth: width ?? '' })}
              onBlur={() => form.touchField('defaultSidebarWidth')}
            />
          </FieldWrapper>
        </Page.Group>
      )}
    </Page.Section>
  );
}
