import {
  Fragment,
  cloneElement,
  isValidElement,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  return <Fragment>{children}</Fragment>;
}

export function DropdownMenuTrigger({
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

export function DropdownMenuContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[6px] border border-[var(--ig-border)] bg-[var(--ig-surface)] p-1 shadow-[0_6px_24px_rgba(0,0,0,0.08)]',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuItem({
  className,
  children,
  type = 'button',
  ...props
}: ComponentPropsWithoutRef<'button'>) {
  return (
    <button
      type={type}
      className={cn(
        'flex min-h-9 w-full items-center rounded-[6px] px-2 text-left text-sm text-[var(--ig-text)] hover:bg-[var(--ig-surface-muted)]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
