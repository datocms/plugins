import type { RenderModalCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import { createDebugLogger, isDebugEnabled } from '../utils/debugLogger';
import s from './styles.module.css';

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
      <Callout tone="danger" title="Couldn't restore the record">
        It can fail when the record links to records that no longer exist. Fix
        the <code>record_body</code> JSON, save the record, and try again.
      </Callout>
      <div className={s.snippet}>
        <CodeSnippet
          code={errorPayloadText}
          ariaLabel="Restoration error"
          maxHeight={400}
        />
      </div>
    </Canvas>
  );
};

export default ErrorModal;
