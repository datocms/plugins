import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import Link from 'datocms-react-ui/Link';
import Main from '../components/Main';
import type { Parameters } from '../types';

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

export default function FieldExtension({ ctx }: PropTypes) {
  const parameters = ctx.plugin.attributes.parameters as Parameters;
  const settingsPath = `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/plugins/${ctx.plugin.id}/edit`;

  return (
    <Canvas ctx={ctx}>
      {'htmlGeneratorUrl' in parameters ? (
        <Main ctx={ctx} />
      ) : (
        <Callout tone="warning">
          Add the frontend metadata endpoint in the{' '}
          {ctx.currentRole.meta.final_permissions.can_edit_schema ? (
            <Link to={settingsPath}>plugin settings</Link>
          ) : (
            'plugin settings'
          )}{' '}
          to run the analysis.
        </Callout>
      )}
    </Canvas>
  );
}
