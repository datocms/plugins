import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, useCtx } from 'datocms-react-ui';
import type { ReactNode } from 'react';

type Props = {
  ctx: RenderConfigScreenCtx;
};

/** Lightweight anchor that uses the plugin navigation API instead of full page loads. */
function Link({ href, children }: { href: string; children: ReactNode }) {
  const ctx = useCtx<RenderConfigScreenCtx>();

  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        ctx.navigateTo(href);
      }}
    >
      {children}
    </a>
  );
}

/** Configuration screen shown in Settings → Plugins. */
export function Config({ ctx }: Props) {
  const schemaUrl = `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/schema`;
  const importUrl = `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/import`;
  const exportUrl = `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/export`;

  return (
    <Canvas ctx={ctx}>
      <div className="config">
        <h3>How this plugin works</h3>

        <ul>
          <li>
            To create an export, visit one of your models/blocks under the{' '}
            <Link href={schemaUrl}>
              <strong>Schema</strong> tab
            </Link>{' '}
            and choose the <strong>Export as JSON</strong> option.
          </li>

          <li>
            To import models/blocks from an exported JSON, go to the{' '}
            <Link href={importUrl}>
              <strong>Schema &gt; Import</strong>
            </Link>{' '}
            page in the sidebar.
          </li>
          <li>
            To export a selection or the entire schema, go to the{' '}
            <Link href={exportUrl}>
              <strong>Schema &gt; Export</strong>
            </Link>{' '}
            page.
          </li>
        </ul>
      </div>
    </Canvas>
  );
}
