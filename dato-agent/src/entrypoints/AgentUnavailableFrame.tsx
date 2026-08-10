import type {
  RenderInspectorCtx,
  RenderInspectorPanelCtx,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import styles from './AgentUnavailableFrame.module.css';

type Props = {
  ctx: RenderInspectorCtx | RenderInspectorPanelCtx | RenderItemFormSidebarCtx;
};

export default function AgentUnavailableFrame({ ctx }: Props) {
  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className={styles.root} role="status">
        <p>Dato Agent is not available for your role.</p>
      </div>
    </Canvas>
  );
}
