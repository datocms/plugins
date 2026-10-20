import type { RenderInspectorPanelCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import styles from './InspectorEmptyPanel.module.css';

type Props = {
  ctx: RenderInspectorPanelCtx;
};

export default function InspectorEmptyPanel({ ctx }: Props) {
  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className={styles.empty}>
        <p>Records will open here</p>
        <p>
          Ask the agent to open a record and it appears in this pane. Drag the
          divider to resize it.
        </p>
      </div>
    </Canvas>
  );
}
