import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { ContentLinkContextProvider } from './ContentLinkContext';
import UI from './UI';

type PropTypes = {
  ctx: RenderInspectorCtx;
};

const Inspector = ({ ctx }: PropTypes) => {
  return (
    <div>
      <Canvas ctx={ctx}>
        <ContentLinkContextProvider>
          <UI />
        </ContentLinkContextProvider>
      </Canvas>
    </div>
  );
};

export default Inspector;
