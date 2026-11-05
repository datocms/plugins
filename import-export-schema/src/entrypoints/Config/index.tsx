import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import { Page } from 'datocms-react-ui/Page';

type Props = {
  ctx: RenderConfigScreenCtx;
};

/**
 * Configuration screen shown in Settings → Plugins. The plugin has no
 * settings: the screen tells where the three flows live and links to each.
 */
export function Config({ ctx }: Props) {
  const environmentPath = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  const schemaUrl = `${environmentPath}/schema`;
  const importUrl = `${environmentPath}/configuration/p/${ctx.plugin.id}/pages/import`;
  const exportUrl = `${environmentPath}/configuration/p/${ctx.plugin.id}/pages/export`;

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the sections start the frame, with no
  // Page around them
  return (
    <>
      <Page.Section>
        <Page.SectionDescription>
          In the schema, open the menu of a model or block and pick “Export as
          JSON”.
        </Page.SectionDescription>
        <Button label="Go to the schema" to={schemaUrl} />
      </Page.Section>
      <Page.Section>
        <Page.SectionTitle>
          Export several models or the whole schema
        </Page.SectionTitle>
        <Page.SectionDescription>
          Pick the models and blocks to export, or export everything at once.
        </Page.SectionDescription>
        <Button label="Go to Export" to={exportUrl} />
      </Page.Section>
      <Page.Section>
        <Page.SectionTitle>Import a schema</Page.SectionTitle>
        <Page.SectionDescription>
          Load a JSON file exported with this plugin, resolve the conflicts and
          import it.
        </Page.SectionDescription>
        <Button label="Go to Import" to={importUrl} />
      </Page.Section>
    </>
  );
}
