import classNames from 'classnames';
import type { ReactNode } from 'react';
import styles from './styles.module.css';

interface ToolbarSlotProps {
  children: ReactNode;
  withLeftBorder?: boolean;
  withPadding?: number;
  flex?: boolean;
}

export function ToolbarSlot({
  children,
  withLeftBorder,
  withPadding,
  flex,
}: ToolbarSlotProps) {
  return (
    <div
      className={classNames(
        styles.slot,
        withLeftBorder && styles.slotWithBorder,
        flex && styles.slotFlex,
      )}
      style={{
        padding: withPadding,
      }}
    >
      {children}
    </div>
  );
}
