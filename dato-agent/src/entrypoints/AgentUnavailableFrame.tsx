import type {
  RenderInspectorCtx,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Canvas from 'datocms-react-ui/Canvas';
import FullFrame from '../components/FullFrame';
import { ChatIcon } from '../icons';
import { TEXTS } from '../texts';

type Props = {
  ctx: RenderInspectorCtx | RenderItemFormSidebarCtx;
};

/** The chat column of the inspector or the record sidebar: both narrow */
export default function AgentUnavailableFrame({ ctx }: Props) {
  return (
    <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
      <FullFrame>
        {/* The frame fails closed: the denial is announced. The wrapper is
            not positioned, thus the blank slate still centers in the frame. */}
        <div role="status">
          <BlankSlate
            placement="area"
            small
            icon={<ChatIcon />}
            title="Dato Agent isn’t available for your role"
            description="Ask a project admin to add your role in the plugin settings."
          />
        </div>
      </FullFrame>
    </Canvas>
  );
}
