import type { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
let context: RenderAssetSourceCtx;
export function setTestContext(value: RenderAssetSourceCtx) {
  context = value;
}
export function useCtx<T>() {
  return context as T;
}
export function Canvas({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
export function Button({
  label,
  submit,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  submit?: boolean;
  busy?: boolean;
  disabled?: unknown;
  onClick?: () => void;
}) {
  return (
    <button
      type={submit ? 'submit' : 'button'}
      disabled={Boolean(busy || disabled)}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
export function StringInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange?: (value: string | null) => void;
}) {
  return (
    <input
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value || null)}
    />
  );
}
export function FieldWrapper({
  error,
  children,
}: {
  error?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      {children}
      {error}
    </>
  );
}
export function RadioGroupInput() {
  return null;
}
export function Callout({
  tone,
  children,
}: {
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function BlankSlate({
  title,
  description,
  caption,
  actions,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  caption?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div>
      {title}
      {description}
      {caption}
      {actions}
      {children}
    </div>
  );
}
export function MediaCard({
  caption,
  children,
}: {
  caption?: ReactNode;
  selection?: { selected: boolean; onSelect?: () => void };
  children?: ReactNode;
}) {
  return (
    <div>
      {children}
      {caption}
    </div>
  );
}
