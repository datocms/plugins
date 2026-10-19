import {
  Tooltip,
  TooltipContent,
  TooltipDelayGroup,
  TooltipTrigger,
} from 'datocms-react-ui';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import styles from './styles.module.css';

interface ButtonGroupProps {
  children: ReactNode;
  className?: string;
}

export function ButtonGroup({ children, className }: ButtonGroupProps) {
  return (
    <TooltipDelayGroup delay={200}>
      <div
        className={
          className ? `${styles.buttonGroup} ${className}` : styles.buttonGroup
        }
      >
        {children}
      </div>
    </TooltipDelayGroup>
  );
}

type ButtonGroupButtonProps =
  | ({ as?: 'button'; tooltip: ReactNode } & Omit<
      ComponentPropsWithoutRef<'button'>,
      'title'
    >)
  | ({ as: 'a'; tooltip: ReactNode } & Omit<
      ComponentPropsWithoutRef<'a'>,
      'title'
    >);

export function ButtonGroupButton(props: ButtonGroupButtonProps) {
  const { as = 'button', tooltip, ...rest } = props;

  const element =
    as === 'button' ? (
      <button {...(rest as ComponentPropsWithoutRef<'button'>)} type="button" />
    ) : (
      <a {...(rest as ComponentPropsWithoutRef<'a'>)} />
    );

  if (!tooltip) {
    return element;
  }

  return (
    <Tooltip>
      <TooltipTrigger>{element}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
