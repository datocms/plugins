import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useEffect } from 'react';
import {
  type Parameters,
  getVisualEditingFrontends,
  normalizeParameters,
} from '../../types';
import { inspectorUrl } from '../../utils/urls';
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

  // If frontend param was provided but no match found, redirect to first available frontend
  useEffect(() => {
    if (
      frontendName &&
      !selectedFrontend &&
      visualEditingFrontends.length > 0
    ) {
      const firstFrontend = visualEditingFrontends[0];
      const path = firstFrontend.visualEditing?.initialPath || '/';

      ctx.navigateTo(
        inspectorUrl(ctx, {
          path,
          frontend: firstFrontend.name,
        }),
      );
    }
  }, [frontendName, selectedFrontend, visualEditingFrontends, ctx]);

  if (!selectedFrontend) {
    // Return null during redirect, or if there are truly no frontends configured
    return null;
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
