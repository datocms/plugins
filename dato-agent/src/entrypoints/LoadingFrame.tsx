import type {
  RenderInspectorCtx,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import Spinner from 'datocms-react-ui/Spinner';
import FullFrame from '../components/FullFrame';
import { TEXTS } from '../texts';

type Props = {
  ctx: RenderInspectorCtx | RenderItemFormSidebarCtx;
};

export default function LoadingFrame({ ctx }: Props) {
  return (
    <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
      <FullFrame>
        <Spinner label="Loading Dato Agent" />
      </FullFrame>
    </Canvas>
  );
}
