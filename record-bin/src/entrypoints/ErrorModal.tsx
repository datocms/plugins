import type { RenderModalCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import { createDebugLogger, isDebugEnabled } from '../utils/debugLogger';

type PropTypes = {
  ctx: RenderModalCtx;
};

const ErrorModal = ({ ctx }: PropTypes) => {
  const debugLogger = createDebugLogger(
    isDebugEnabled(ctx.plugin.attributes.parameters),
    'ErrorModal',
  );

  const errorPayloadText = (ctx.parameters.errorPayload as string)
    .replaceAll('\\n', '\n')
    .replaceAll('\\', '');

  debugLogger.log('Rendering error payload in modal', {
    payloadLength: errorPayloadText.length,
  });

  return (
    <Canvas ctx={ctx}>
      <CodeSnippet
        code={errorPayloadText}
        ariaLabel="Restoration error"
        maxHeight={400}
      />
    </Canvas>
  );
};

export default ErrorModal;
