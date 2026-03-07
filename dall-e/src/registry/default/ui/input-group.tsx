import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
} from 'react';
import { cn } from '@/lib/cn';

type InputGroupProps = HTMLAttributes<HTMLDivElement>;

export const InputGroup = forwardRef<HTMLDivElement, InputGroupProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-3 rounded-[var(--ig-radius)] border border-[var(--ig-border)] bg-[var(--ig-surface)] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
        className,
      )}
      {...props}
    />
  ),
);

InputGroup.displayName = 'InputGroup';

type InputGroupTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const InputGroupTextarea = forwardRef<
  HTMLTextAreaElement,
  InputGroupTextareaProps
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'block h-full min-h-0 w-full flex-1 resize-none overflow-y-auto border-0 bg-transparent p-0 text-[18px] leading-7 text-[var(--ig-text)] outline-none placeholder:text-[var(--ig-text-muted)]',
      className,
    )}
    {...props}
  />
));

InputGroupTextarea.displayName = 'InputGroupTextarea';

type InputGroupAddonProps = HTMLAttributes<HTMLDivElement> & {
  align?: 'block-start' | 'block-end';
};

export const InputGroupAddon = forwardRef<HTMLDivElement, InputGroupAddonProps>(
  ({ className, align = 'block-start', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-2 border-t border-[var(--ig-border)] pt-3',
        align === 'block-end' ? 'justify-between' : 'justify-start',
        className,
      )}
      {...props}
    />
  ),
);

InputGroupAddon.displayName = 'InputGroupAddon';

type InputGroupButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'default' | 'sm' | 'icon-sm';
  variant?: 'default' | 'ghost';
};

const sizeClassNames: Record<NonNullable<InputGroupButtonProps['size']>, string> = {
  default: 'h-10 px-4 text-sm',
  sm: 'h-9 px-3 text-sm',
  'icon-sm': 'h-9 min-w-9 px-3 text-sm',
};

const variantClassNames: Record<
  NonNullable<InputGroupButtonProps['variant']>,
  string
> = {
  default:
    'border border-[var(--ig-accent)] bg-[var(--ig-accent)] text-[var(--ig-accent-contrast)] hover:brightness-[0.98]',
  ghost:
    'border border-[var(--ig-border)] bg-[var(--ig-surface)] text-[var(--ig-text)] hover:border-[var(--ig-border-strong)]',
};

export const InputGroupButton = forwardRef<
  HTMLButtonElement,
  InputGroupButtonProps
>(({ className, size = 'default', variant = 'ghost', type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-[6px] font-medium transition-[background-color,border-color,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ig-focus)] disabled:cursor-not-allowed disabled:opacity-60',
      sizeClassNames[size],
      variantClassNames[variant],
      className,
    )}
    {...props}
  />
));

InputGroupButton.displayName = 'InputGroupButton';
