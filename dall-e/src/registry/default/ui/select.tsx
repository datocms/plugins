import {
  createContext,
  useContext,
  useMemo,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

type SelectContextValue = {
  value?: string;
  onValueChange?: (value: string) => void;
};

const SelectContext = createContext<SelectContextValue | null>(null);

export function Select({
  value,
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}) {
  const context = useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  return <SelectContext.Provider value={context}>{children}</SelectContext.Provider>;
}

export function SelectTrigger({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-9 items-center rounded-[6px] border border-[var(--ig-border)] bg-[var(--ig-surface)] px-3 text-sm text-[var(--ig-text)]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function SelectValue({ placeholder }: { placeholder?: ReactNode }) {
  const context = useContext(SelectContext);
  return <>{context?.value ?? placeholder ?? null}</>;
}

export function SelectContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
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

export function SelectItem({
  value,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLButtonElement> & { value: string }) {
  const context = useContext(SelectContext);
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-9 w-full items-center rounded-[6px] px-2 text-left text-sm text-[var(--ig-text)] hover:bg-[var(--ig-surface-muted)]',
        className,
      )}
      onClick={() => context?.onValueChange?.(value)}
      {...props}
    >
      {children}
    </button>
  );
}
