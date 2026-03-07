import {
  Fragment,
  cloneElement,
  isValidElement,
  type HTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

export function HoverCard({ children }: { children: React.ReactNode }) {
  return <Fragment>{children}</Fragment>;
}

export function HoverCardTrigger({
  asChild,
  children,
}: {
  asChild?: boolean;
  children: React.ReactNode;
}) {
  if (asChild && isValidElement(children)) {
    return cloneElement(children);
  }

  return <Fragment>{children}</Fragment>;
}

export function HoverCardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[6px] border border-[var(--ig-border)] bg-[var(--ig-surface)] p-3 text-sm text-[var(--ig-text)] shadow-[0_6px_24px_rgba(0,0,0,0.08)]',
        className,
      )}
      {...props}
    />
  );
}
