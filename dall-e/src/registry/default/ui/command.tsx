import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '@/lib/cn';

export const Command = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col', className)} {...props} />
  ),
);
Command.displayName = 'Command';

export const CommandInput = forwardRef<
  HTMLInputElement,
  ComponentPropsWithoutRef<'input'>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-9 w-full rounded-[6px] border border-[var(--ig-border)] bg-[var(--ig-surface)] px-3 text-sm text-[var(--ig-text)] outline-none',
      className,
    )}
    {...props}
  />
));
CommandInput.displayName = 'CommandInput';

export const CommandList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1', className)} {...props} />
  ),
);
CommandList.displayName = 'CommandList';

export const CommandEmpty = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-2 py-3 text-sm text-[var(--ig-text-muted)]', className)} {...props} />
  ),
);
CommandEmpty.displayName = 'CommandEmpty';

export const CommandGroup = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1', className)} {...props} />
  ),
);
CommandGroup.displayName = 'CommandGroup';

export const CommandItem = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'flex min-h-9 w-full items-center rounded-[6px] px-2 text-left text-sm text-[var(--ig-text)] hover:bg-[var(--ig-surface-muted)]',
        className,
      )}
      {...props}
    />
  ),
);
CommandItem.displayName = 'CommandItem';

export const CommandSeparator = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('my-1 h-px bg-[var(--ig-border)]', className)} {...props} />
  ),
);
CommandSeparator.displayName = 'CommandSeparator';
