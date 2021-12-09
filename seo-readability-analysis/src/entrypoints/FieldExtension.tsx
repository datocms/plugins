import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import Main from '../components/Main';
import { Parameters } from '../types';

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

export default function FieldExtension({ ctx }: PropTypes) {
  const parameters = ctx.plugin.attributes.parameters as Parameters;

  return (
    <Canvas ctx={ctx}>
      {'htmlGeneratorUrl' in parameters ? (
        <Main ctx={ctx} />
      ) : (
        <p>Invalid configuration!</p>
      )}
    </Canvas>
  );
}
