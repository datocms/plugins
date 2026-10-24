import type {
  RenderInspectorCtx,
  RenderInspectorPanelCtx,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Canvas from 'datocms-react-ui/Canvas';
import FullFrame from '../components/FullFrame';
import { ChatIcon } from '../icons';
import { TEXTS } from '../texts';

type Props = {
  ctx: RenderInspectorCtx | RenderInspectorPanelCtx | RenderItemFormSidebarCtx;
};

export default function AgentUnavailableFrame({ ctx }: Props) {
  // The inspector and the record sidebar are narrow; the inspector panel is
  // the wide record pane
  const small = ctx.mode !== 'renderInspectorPanel';

  return (
    <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
      <FullFrame>
        {/* The frame fails closed: the denial is announced. The wrapper is
            not positioned, thus the blank slate still centers in the frame. */}
        <div role="status">
          <BlankSlate
            placement="area"
            small={small}
            icon={<ChatIcon />}
            title="Dato Agent isn’t available for your role"
            description="Ask a project admin to add your role in the plugin settings."
          />
        </div>
      </FullFrame>
    </Canvas>
  );
}
