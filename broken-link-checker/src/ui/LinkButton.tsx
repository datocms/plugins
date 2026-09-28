import type { ReactNode } from 'react';

/** An inline text action (the recipe's `.dl-button--link`). */
export function LinkButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={
        className
          ? `dl-button dl-button--link ${className}`
          : 'dl-button dl-button--link'
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}
