import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import {
  type Parameters,
  getVisualEditingFrontends,
  normalizeParameters,
} from '../../types';
import { ContentLinkContextProvider } from './ContentLinkContext';
import UI from './UI';

type PropTypes = {
  ctx: RenderInspectorCtx;
};

const Inspector = ({ ctx }: PropTypes) => {
  const params = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );
  const visualEditingFrontends = getVisualEditingFrontends(params);

  const urlParams = new URLSearchParams(ctx.location.search);
  const frontendName = urlParams.get('frontend');
  const selectedFrontend = frontendName
    ? visualEditingFrontends.find((f) => f.name === frontendName)
    : visualEditingFrontends[0];

  if (!selectedFrontend) {
    return (
      <Canvas ctx={ctx}>
        <div style={{ padding: 'var(--spacing-m)' }}>
          No frontends with visual editing enabled. Configure visual editing for
          at least one frontend in plugin settings.
        </div>
      </Canvas>
    );
  }

  return (
    <div>
      <Canvas ctx={ctx}>
        <ContentLinkContextProvider frontend={selectedFrontend}>
          <UI />
        </ContentLinkContextProvider>
      </Canvas>
    </div>
  );
};

export default Inspector;
