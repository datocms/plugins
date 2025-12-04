import type { RenderInspectorPanelCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';

type Props = {
  ctx: RenderInspectorPanelCtx;
};

export default function InspectorLoading({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <Spinner placement="centered" />
    </Canvas>
  );
}
