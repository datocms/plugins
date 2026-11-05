import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';
import { PAGE_ID } from '../constants';
import { useFrameSizedToContent } from '../ui/useFrameSizedToContent';
import s from './ConfigScreen.module.css';

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

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the sections start the frame, with no
  // Page around them
  return (
    <Canvas ctx={ctx}>
      {!hasToken && (
        <Callout tone="warning">
          To scan the whole project, grant this plugin permission to make API
          calls on behalf of the logged-in user.
        </Callout>
      )}
      {/* Without the permission the content area has no "Link checker": the
          callout above says what's missing. */}
      {hasToken && (
        <Page.Section>
          <Page.SectionDescription>
            Scan the saved records of this environment from “Link checker” in
            the content area.
          </Page.SectionDescription>
          <Button label="Open Link checker" to={pagePath} />
        </Page.Section>
      )}
      <Page.Section className={s.endSection}>
        {/* Without project scans, record checks are the first part of the
            screen: no title */}
        {hasToken && <Page.SectionTitle>Record checks</Page.SectionTitle>}
        <Page.SectionDescription>
          Check the record you're editing from its “Broken links” sidebar panel.
        </Page.SectionDescription>
      </Page.Section>
    </Canvas>
  );
}
