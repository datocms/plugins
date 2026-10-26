import CardList from 'datocms-react-ui/CardList';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import EntityRow from 'datocms-react-ui/EntityRow';
import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
import { DocLinks } from './DocLinks';
import { FrontendFields } from './FrontendFields';
import { FRONTEND_DOC_LINKS } from './links';
import type { SettingsForm } from './useSettingsForm';
import { type FeatureSwitches, hasErrors } from './validation';

/** What the frontend offers, under its name: the features turned on */
function featureSummary(switches: FeatureSwitches) {
  const features = [
    switches.previewLinks ? 'Preview links' : undefined,
    switches.visualEditing ? 'Visual editing' : undefined,
  ].filter(Boolean);

  return features.length > 0 ? features.join(' · ') : 'Nothing turned on';
}

type Props = {
  form: SettingsForm;
};

export function FrontendsSection({ form }: Props) {
  const frontends = form.draft.frontends ?? [];
  const add = { label: 'Add frontend', onClick: form.addFrontend };

  return (
    <Page.Section>
      <Page.SectionTitle>Frontends</Page.SectionTitle>
      <Page.SectionDescription>
        <p>
          The websites that show your records. Each frontend can return preview
          links, offer visual editing, or both.
        </p>
        <DocLinks links={FRONTEND_DOC_LINKS} />
      </Page.SectionDescription>
      <CardList
        add={add}
        empty={<EmptySlot message="No frontends yet" action={add} />}
      >
        {frontends.map((frontend, index) => {
          const key = form.frontendKeys[index] ?? `frontend-at-${index}`;
          const path = (field: string) => `${key}.${field}`;
          const switches = form.frontendSwitches[index];
          const errors = form.errors.frontends[index] ?? {};
          // A card that shows an error can't close until the error is fixed,
          // as the Viewports section: its closed row wouldn't show the error
          const locked = form.submitAttempted && hasErrors(errors);

          return (
            <CardList.Item
              key={key}
              row={{
                summary: (
                  <EntityRow
                    layout="row"
                    // Unnamed frontends stay apart by their position
                    title={frontend.name || `Frontend ${index + 1}`}
                    afterTitle={
                      frontend.disabled ? <Pill>Hidden</Pill> : undefined
                    }
                  >
                    {featureSummary(switches)}
                  </EntityRow>
                ),
                actions: (
                  <CardList.RemoveButton
                    label="Remove frontend"
                    onClick={() => form.removeFrontend(index)}
                  />
                ),
              }}
              expandable={{
                open: form.openFrontends.has(key) || locked,
                onToggle: () => {
                  if (!locked) {
                    form.toggleFrontend(key);
                  }
                },
                body: (
                  <FrontendFields
                    frontend={frontend}
                    switches={switches}
                    errors={errors}
                    submitAttempted={form.submitAttempted}
                    showsError={(field) => form.showsError(path(field))}
                    headersTouched={
                      form.submitAttempted || (form.touchedHeaders[key] ?? [])
                    }
                    onChange={(patch) => form.updateFrontend(index, patch)}
                    onFeatureChange={(feature, on) =>
                      form.setFeature(index, feature, on)
                    }
                    onBlur={(field) => form.touchField(path(field))}
                    onHeadersChange={(change) =>
                      form.followHeaders(key, change)
                    }
                    onHeaderCellBlur={(cell) => form.touchHeaderCell(key, cell)}
                  />
                ),
              }}
            />
          );
        })}
      </CardList>
    </Page.Section>
  );
}
