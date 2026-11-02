import type { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
type Message = ReactNode | { id: string; values?: Record<string, unknown> };
// A text key of the plugin shows as its id, with its values
function text(message: Message): ReactNode {
  return message && typeof message === 'object' && 'id' in message
    ? `${message.id} ${JSON.stringify(message.values ?? {})}`
    : message;
}
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
export function TextareaInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange?: (value: string | null) => void;
}) {
  return (
    <textarea
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
  title,
  children,
}: {
  tone?: string;
  title?: Message;
  children?: ReactNode;
}) {
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      {text(title)}
      {children}
    </div>
  );
}
export function Link({ to, children }: { to: string; children?: ReactNode }) {
  return <a href={to}>{children}</a>;
}
export function BlankSlate({
  title,
  description,
  caption,
  actions,
  children,
}: {
  title?: Message;
  description?: Message;
  caption?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div>
      {text(title)}
      {text(description)}
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
  caption?: { text: ReactNode; muted?: boolean };
  selection?: { selected: boolean; onSelect?: () => void };
  children?: ReactNode;
}) {
  return (
    <div>
      {children}
      {caption?.text}
    </div>
  );
}
