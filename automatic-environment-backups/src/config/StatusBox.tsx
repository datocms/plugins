import type { CSSProperties, ReactNode } from 'react';

/** Visual tone of a {@link StatusBox}, mapped to the dashboard soft-color tokens. */
export type StatusBoxVariant = 'neutral' | 'success' | 'error' | 'warning';

type StatusBoxProps = {
  variant: StatusBoxVariant;
  title?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
};

type VariantTokens = {
  border: string;
  surface: string;
  ink: string;
};

const VARIANT_TOKENS: Record<StatusBoxVariant, VariantTokens> = {
  neutral: {
    border: 'var(--color--border)',
    surface: 'var(--color--light-bg, var(--color--surface))',
    ink: 'var(--color--ink)',
  },
  success: {
    border: 'var(--color--success-soft--border)',
    surface: 'var(--color--success-soft--surface)',
    ink: 'var(--color--success-soft--ink)',
  },
  error: {
    border: 'var(--color--danger-soft--border)',
    surface: 'var(--color--danger-soft--surface)',
    ink: 'var(--color--danger-soft--ink)',
  },
  warning: {
    border: 'var(--color--warning-soft--border)',
    surface: 'var(--color--warning-soft--surface)',
    ink: 'var(--color--warning-soft--ink)',
  },
};

/**
 * Presentational status panel used across the setup steps and the overview.
 * The `variant` selects a soft-color palette matching the DatoCMS dashboard;
 * content is arbitrary so callers can render remediation text or lists.
 */
export const StatusBox = ({ variant, title, children, style }: StatusBoxProps) => {
  const tokens = VARIANT_TOKENS[variant];

  return (
    <div
      style={{
        border: `1px solid ${tokens.border}`,
        borderRadius: '6px',
        background: tokens.surface,
        color: tokens.ink,
        padding: 'var(--spacing-m)',
        fontSize: 'var(--font-size-s)',
        lineHeight: 1.4,
        textAlign: 'left',
        ...style,
      }}
    >
      {title && (
        <p
          style={{
            margin: 0,
            marginBottom: children ? 'var(--spacing-xs)' : 0,
            fontWeight: 600,
          }}
        >
          {title}
        </p>
      )}
      {children}
    </div>
  );
};
