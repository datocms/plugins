import type { ReactNode } from 'react';
import s from '../../entrypoints/styles.module.css';

interface ButtonTooltipProps {
  children: ReactNode;
  tooltip: string;
}

/**
 * Component that displays a tooltip when hovering over a button or other control
 */
const ButtonTooltip = ({ 
  children, 
  tooltip 
}: ButtonTooltipProps) => {
  if (!tooltip) {
    return <>{children}</>;
  }

  return (
    <div className={s.buttonTooltip}>
      {children}
      <span className={s.tooltipText}>{tooltip}</span>
    </div>
  );
};

export default ButtonTooltip;
