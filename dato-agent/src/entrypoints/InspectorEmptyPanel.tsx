import type { RenderInspectorPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Canvas from 'datocms-react-ui/Canvas';
import FullFrame from '../components/FullFrame';
import { RecordIcon } from '../icons';
import { TEXTS } from '../texts';

type Props = {
  ctx: RenderInspectorPanelCtx;
};

export default function InspectorEmptyPanel({ ctx }: Props) {
  return (
    <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
      <FullFrame>
        <BlankSlate
          description="Ask the agent to open a record and it appears in this pane. Drag the divider to resize it."
          icon={<RecordIcon />}
          placement="area"
          title="No record open"
        />
      </FullFrame>
    </Canvas>
  );
}
