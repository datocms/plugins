import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';
import SettingsList from 'datocms-react-ui/SettingsList';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;

  return (
    <Canvas ctx={ctx}>
      <Page>
        <Page.Content>
          <Page.Group title="Asset optimization">
            <SettingsList>
              <SettingsList.Row
                title="Optimize assets"
                description="Pick the settings, preview the savings, then replace the large images of this environment."
                action={
                  <Button
                    tone="ghost"
                    label="Open asset optimization"
                    to={`${environmentPrefix}/configuration/p/${ctx.plugin.id}/pages/optimize-assets`}
                  />
                }
              />
            </SettingsList>
          </Page.Group>
        </Page.Content>
      </Page>
    </Canvas>
  );
}
