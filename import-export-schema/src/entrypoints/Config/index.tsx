import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, useCtx } from 'datocms-react-ui';
import type { ReactNode } from 'react';

type Props = {
  ctx: RenderConfigScreenCtx;
};

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

export function Config({ ctx }: Props) {
  const schemaUrl = `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/schema`;
  const pageUrl = `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/import-export`;

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
            Need to import some models/blocks from an already generated export?
            Go to the{' '}
            <Link href={pageUrl}>
              <strong>Schema &gt; Import/Export</strong> section
            </Link>{' '}
            on the sidebar.
          </li>
        </ul>
      </div>
    </Canvas>
  );
}
