import type { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import type { ComponentProps } from 'react';
let context: RenderAssetSourceCtx;
export function setTestContext(value: RenderAssetSourceCtx) {
  context = value;
}
export function useCtx<T>() {
  return context as T;
}
export function Button({
  buttonType: _buttonType,
  ...props
}: ComponentProps<'button'> & { buttonType?: string }) {
  return <button {...props} />;
}
export function Spinner(_props: { size?: number; style?: unknown }) {
  return <span />;
}
