import type { ReactNode } from 'react';
import s from '../../entrypoints/styles.module.css';

interface ParamTooltipProps {
  children: ReactNode;
  paramName: string;
  paramValue?: string | number | boolean;
}

/**
 * Component that displays a tooltip showing the actual URL parameter
 * when hovering over a setting control
 */
const ParamTooltip = ({ 
  children, 
  paramName, 
  paramValue 
}: ParamTooltipProps) => {
  // Format the parameter string to show in the tooltip
  const formatParamString = () => {
    if (paramValue === undefined || paramValue === null) {
      return `${paramName}`;
    }
    
    // For boolean values
    if (typeof paramValue === 'boolean') {
      // Only show the parameter if it's true, as false usually means omitting the parameter
      return paramValue ? `${paramName}=1` : '';
    }
    
    // For other values (strings, numbers)
    return `${paramName}=${paramValue}`;
  };

  const paramString = formatParamString();
  
  // Don't show tooltip if there's no parameter string
  if (!paramString) {
    return <>{children}</>;
  }

  return (
    <div className={s.paramTooltip}>
      {children}
      <span className={s.tooltipText}>{paramString}</span>
    </div>
  );
};

export default ParamTooltip;
