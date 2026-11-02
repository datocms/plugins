import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
import SettingsList from 'datocms-react-ui/SettingsList';
import { PAGE_ID } from '../constants';
import { useFrameSizedToContent } from '../ui/useFrameSizedToContent';

type Props = {
  ctx: RenderConfigScreenCtx;
};

/** Nothing to configure: what the plugin does, and where to find it. */
export default function ConfigScreen({ ctx }: Props) {
  useFrameSizedToContent();
  const hasToken = ctx.plugin.attributes.permissions.includes(
    'currentUserAccessToken',
  );
  // Sandbox environments live under their own prefix; the primary has none.
  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  const pagePath = `${environmentPrefix}/editor/p/${ctx.plugin.id}/pages/${PAGE_ID}`;

  return (
    <Canvas ctx={ctx}>
      <Page>
        <Page.Content>
          {!hasToken && (
            <Page.Group
              title="API access"
              tone="warning"
              status={<Pill tone="warning">Not granted</Pill>}
            >
              <Callout tone="warning">
                To scan the whole project, grant this plugin permission to make
                API calls on behalf of the logged-in user.
              </Callout>
            </Page.Group>
          )}
          <Page.Group title="Link checker">
            <SettingsList>
              {/* Without the permission the content area has no "Link checker": the group above says what's missing. */}
              {hasToken && (
                <SettingsList.Row
                  title="Project scans"
                  description="Scan the saved records of this environment from “Link checker” in the content area."
                  action={
                    <Button
                      tone="ghost"
                      label="Open Link checker"
                      to={pagePath}
                    />
                  }
                />
              )}
              <SettingsList.Row
                title="Record checks"
                description="Check the record you're editing from its “Broken links” sidebar panel."
              />
            </SettingsList>
          </Page.Group>
        </Page.Content>
      </Page>
    </Canvas>
  );
}
