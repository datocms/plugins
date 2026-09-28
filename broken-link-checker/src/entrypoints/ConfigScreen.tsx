import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { PAGE_ID } from '../constants';
import { Button } from '../ui/Button';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  const hasToken = ctx.plugin.attributes.permissions.includes(
    'currentUserAccessToken',
  );
  // Sandbox environments live under their own prefix; the primary has none.
  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  const pagePath = `${environmentPrefix}/editor/p/${ctx.plugin.id}/pages/${PAGE_ID}`;

  const openPage = async () => {
    try {
      await ctx.navigateTo(pagePath);
    } catch (error) {
      console.error(error);
      void ctx.alert("Couldn't open the Link checker!");
    }
  };

  return (
    <Canvas ctx={ctx}>
      <div className="dl-kit-form-parity blc-config">
        {!hasToken && (
          <div className="dl-callout dl-callout--warning">
            <p>
              Project scans need permission to make API calls on behalf of the
              logged-in user, which this plugin doesn't have. Ask a project
              admin to grant it, then reload the page. Checks from the record
              sidebar panel still work.
            </p>
          </div>
        )}
        <p>
          The <strong>Link checker</strong> finds broken website links in your
          records. There's nothing to configure here.
        </p>
        {/* Without the permission the page can't scan, so nothing leads there. */}
        {hasToken && (
          <>
            <p>
              Scan saved records from "Link checker" in the Content area, or
              check the record you're editing from its "Broken links" sidebar
              panel.
            </p>
            <Button buttonSize="s" onClick={() => void openPage()}>
              Go to Link checker
            </Button>
          </>
        )}
      </div>
    </Canvas>
  );
}
