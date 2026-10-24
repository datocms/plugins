import { useCtx } from 'datocms-react-ui/Canvas';
import type { ReactNode } from 'react';
import styles from './FullFrame.module.css';

type Props = {
  children: ReactNode;
};

/**
 * The whole frame, as a box: the positioned parent with a height that a
 * Pane, a centered Spinner and a BlankSlate with placement "area" fill. Use
 * it in a frame that sets its own height (a Canvas with noAutoResizer), where
 * the content does not give the height. The box keeps the body padding that
 * the host gives to the Canvas.
 */
export default function FullFrame({ children }: Props) {
  const { bodyPadding } = useCtx();
  const inset = bodyPadding.map((side) => `${side}px`).join(' ');

  return (
    <div className={styles.root} style={{ inset }}>
      {children}
    </div>
  );
}
