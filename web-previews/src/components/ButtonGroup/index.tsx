import { FloatingDelayGroup } from '@floating-ui/react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../Tooltip';
import styles from './styles.module.css';

interface ButtonGroupProps {
  children: ReactNode;
}

export function ButtonGroup({ children }: ButtonGroupProps) {
  return (
    <FloatingDelayGroup delay={200}>
      <div className={styles.buttonGroup}>{children}</div>
    </FloatingDelayGroup>
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
