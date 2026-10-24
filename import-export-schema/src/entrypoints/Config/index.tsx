import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import { Page } from 'datocms-react-ui/Page';
import SettingsList from 'datocms-react-ui/SettingsList';

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

  return (
    <Page>
      <Page.Content>
        <Page.Group title="Import and export">
          <SettingsList>
            <SettingsList.Row
              title="Export a model or block"
              description="In the schema, open the menu of a model or block and pick “Export as JSON”."
              action={
                <Button tone="ghost" label="Go to the schema" to={schemaUrl} />
              }
            />
            <SettingsList.Row
              title="Export several models or the whole schema"
              description="Pick the models and blocks to export, or export everything at once."
              action={
                <Button tone="ghost" label="Go to Export" to={exportUrl} />
              }
            />
            <SettingsList.Row
              title="Import a schema"
              description="Load a JSON file exported with this plugin, resolve the conflicts and import it."
              action={
                <Button tone="ghost" label="Go to Import" to={importUrl} />
              }
            />
          </SettingsList>
        </Page.Group>
      </Page.Content>
    </Page>
  );
}
