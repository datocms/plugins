import classNames from 'classnames';
import { TooltipDelayGroup } from 'datocms-react-ui';
import type { ReactNode } from 'react';
import styles from './styles.module.css';

interface ToolbarProps {
  children: ReactNode;
  /** As tall as the DatoCMS inspector panel header, to sit beside it */
  tall?: boolean;
}

export function Toolbar({ children, tall }: ToolbarProps) {
  return (
    <TooltipDelayGroup delay={200}>
      <div className={classNames(styles.toolbar, tall && styles.tall)}>
        {children}
      </div>
    </TooltipDelayGroup>
  );
}
