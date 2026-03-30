import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

/**
 * Renders a small loading placeholder in a DatoCMS Canvas.
 */
function LoadingAddon({ ctx }: PropTypes) {
  return <Canvas ctx={ctx}>Loading...</Canvas>;
}

export default LoadingAddon;
/**
 * LoadingAddon.tsx
 * Minimal field extension that renders a lightweight loading state within Canvas.
 * Used as a placeholder when an extension needs time to initialize.
 */
