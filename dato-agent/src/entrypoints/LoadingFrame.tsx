import type {
  RenderInspectorCtx,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import styles from './LoadingFrame.module.css';

type Props = {
  ctx: RenderInspectorCtx | RenderItemFormSidebarCtx;
};

export default function LoadingFrame({ ctx }: Props) {
  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className={styles.root} role="status">
        <Spinner placement="centered" size={36} />
        <span className={styles.visuallyHidden}>
          Loading Dato Agent (Beta)…
        </span>
      </div>
    </Canvas>
  );
}
