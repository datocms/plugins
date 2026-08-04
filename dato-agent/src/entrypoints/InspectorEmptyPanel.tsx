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
      </div>
    </Canvas>
  );
}
